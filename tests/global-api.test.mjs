import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";
import { PolicyStore } from "../lib/policy-store.js";

const session = (id, cwd) => ({
  id,
  header: { title: id, cwd, agentPreset: "standard" },
  agentPreset: "standard"
});

let skillRoot = "D:/skills";
const skill = (name, source = "custom", invocation = { modelInvocable: true, userInvocable: true }) => ({
  name,
  description: `${name} description`,
  provider: "test-filesystem",
  source,
  invocation,
  ...["project-dsh", "project-agents", "custom", "user-dsh", "user-agents"].includes(source) ? {
    path: join(skillRoot, name, "SKILL.md"),
    resourceBase: { kind: "directory", path: join(skillRoot, name) }
  } : {}
});

test("global API aggregates scopes and controls model/user channels independently", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "dsh-skills-management-api-"));
  skillRoot = home;
  for (const name of ["skill-one", "skill-two", "file-skill"]) {
    await mkdir(join(home, name), { recursive: true });
    await writeFile(join(home, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} description\n---\n\n${name} original body\n`, "utf8");
  }
  const routes = new Map();
  const invalidators = new Set();
  const emitted = [];
  let invalidationCalls = 0;
  let omitOriginal = false;
  let conflictingOriginal = false;
  let reorderedResourceBase = false;
  let failingList = false;
  let failingAcquire = false;
  let incompleteSnapshot = false;
  let includeFileSkill = false;
  let skillTwoInvocation = { modelInvocable: true, userInvocable: true };
  const registry = {
    async list({ cwd }) {
      if (failingList && cwd === "D:/two") throw new Error("scope unavailable");
      if (cwd === "D:/one") return [skill("skill-one")];
      if (cwd === "D:/two") return [skill("skill-one"), skill("skill-two", "user-dsh", skillTwoInvocation)];
      return includeFileSkill
        ? [skill("global-skill", "runtime"), skill("file-skill", "custom")]
        : [skill("global-skill", "runtime")];
    },
    async get(name, options = {}) {
      if (omitOriginal && name === "skill-one") return undefined;
      const found = [skill("skill-one"), skill("skill-two", "user-dsh", skillTwoInvocation), skill("global-skill", "runtime"), skill("file-skill", "custom")]
        .find((entry) => entry.name === name);
      if (found === undefined) return undefined;
      return {
        ...found,
        ...reorderedResourceBase && name === "skill-one" ? {
          resourceBase: options.cwd === "D:/two"
            ? { path: "D:/skill-one", kind: "directory" }
            : { kind: "directory", path: "D:/skill-one" }
        } : {},
        content: conflictingOriginal && name === "skill-one" && options.cwd === "D:/two"
          ? "different scope body"
          : `${name} original body`
      };
    },
    registerProvider(create) {
      const control = { invalidate: () => { invalidationCalls += 1; } };
      const provider = create(control);
      invalidators.add(control.invalidate);
      return () => invalidators.delete(control.invalidate);
    }
  };
  const sessions = [session("s1", "D:/one"), session("s2", "D:/two")];
  const presets = {
    serviceFor: () => registry,
    acquireScope: async () => {
      if (failingAcquire) throw new Error("preset scope unavailable");
      return {
        key: {},
        async [Symbol.asyncDispose]() {}
      };
    }
  };
  const ctx = {
    logger: { warn() {}, info() {} },
    get(name) {
      if (name === "skills") return registry;
      if (name === "agentPresets") return presets;
      if (name === "loader") return { entries: () => [] };
      return undefined;
    },
    agents: { list: () => [], get: () => undefined },
    sessions: { list: () => sessions },
    workingDirectory: { defaultDirectory: "D:/default", ensure: async () => "D:/default" },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      }
    },
    effect(callback) {
      return callback();
    },
    on() {
      return () => {};
    },
    emit(name) {
      emitted.push(name);
    }
  };
  t.after(async () => {
    await rm(home, { recursive: true, force: true });
  });
  apply(ctx, {
    dshHome: join(home, ".dsh"),
    agentsHome: join(home, ".agents"),
    policyFile: join(home, "disabled.json")
  });

  const listRoute = routes.get("/api/dsh-skills-management/list");
  const setRoute = routes.get("/api/dsh-skills-management/set");
  assert.equal(typeof listRoute, "function");
  assert.equal(typeof setRoute, "function");

  const request = (method, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = "/api/dsh-skills-management/test";
    req.headers = {
      host: "127.0.0.1:12345",
      ...body === undefined ? {} : { "content-type": "application/json", "x-dsh-skills-management": "1" }
    };
    req.socket = { remoteAddress: "127.0.0.1" };
    return req;
  };
  const response = () => {
    const result = { status: 0, body: "" };
    return {
      result,
      writeHead(status) { result.status = status; },
      end(body) { result.body = body; }
    };
  };

  let res = response();
  await listRoute(request("GET"), res);
  assert.equal(res.result.status, 200);
  const listed = JSON.parse(res.result.body);
  assert.equal(listed.skills.length, 3, "global inventory aggregates all scopes");
  assert.equal("sessionId" in listed, false);
  assert.equal("sessions" in listed, false);
  assert.equal("cwd" in listed, false);
  assert.equal(listed.skills.find((row) => row.name === "skill-one").missing, false);
  assert.equal(listed.skills.find((row) => row.name === "global-skill").manageable, false);
  res = response();
  await setRoute(request("POST", { name: "global-skill", channel: "model", enabled: false }), res);
  assert.equal(res.result.status, 409, "non-file providers reject policy edits on the Host");
  assert.equal(JSON.parse(res.result.body).code, "non-file-provider");
  await assert.rejects(readFile(join(home, "disabled.json"), "utf8"), /ENOENT/);

  // The initial request covers the old list() fallback. Later requests use the
  // current snapshot().complete contract, including original-body reads.
  registry.snapshot = async (options) => ({
    skills: await registry.list(options),
    complete: !incompleteSnapshot
  });

  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: false }), res);
  assert.equal(res.result.status, 200);
  assert.deepEqual(JSON.parse(res.result.body).invocation, { modelInvocable: false, userInvocable: true });

  res = response();
  await listRoute(request("GET"), res);
  let current = JSON.parse(res.result.body).skills.find((entry) => entry.name === "skill-one");
  assert.equal(current.disabled, true);
  assert.equal(current.modelInvocable, false);
  assert.equal(current.userInvocable, true);

  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "user", enabled: false }), res);
  assert.equal(res.result.status, 200);
  assert.deepEqual(JSON.parse(res.result.body).invocation, { modelInvocable: false, userInvocable: false });

  res = response();
  await listRoute(request("GET"), res);
  const disabled = JSON.parse(res.result.body);
  current = disabled.skills.find((entry) => entry.name === "skill-one");
  assert.equal(current.modelInvocable, false);
  assert.equal(current.userInvocable, false);
  assert.equal(disabled.skills.length, 3, "restricted row remains in the global inventory");

  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 200);
  assert.deepEqual(JSON.parse(res.result.body).invocation, { modelInvocable: true, userInvocable: false });

  res = response();
  await listRoute(request("GET"), res);
  current = JSON.parse(res.result.body).skills.find((entry) => entry.name === "skill-one");
  assert.equal(current.modelInvocable, true);
  assert.equal(current.userInvocable, false);

  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "user", enabled: true }), res);
  assert.equal(res.result.status, 200);

  res = response();
  await listRoute(request("GET"), res);
  const restored = JSON.parse(res.result.body).skills.find((entry) => entry.name === "skill-one");
  assert.equal(restored.disabled, false);
  assert.equal(restored.modelInvocable, true);
  assert.equal(restored.userInvocable, true);
  assert.equal(invalidators.size, 1);
  assert.ok(invalidationCalls >= 1);
  assert.ok(emitted.includes("commands/change"));

  const concurrentModel = response();
  const concurrentUser = response();
  await Promise.all([
    setRoute(request("POST", { name: "skill-one", channel: "model", enabled: false }), concurrentModel),
    setRoute(request("POST", { name: "skill-one", channel: "user", enabled: false }), concurrentUser)
  ]);
  assert.equal(concurrentModel.result.status, 200);
  assert.equal(concurrentUser.result.status, 200);
  const concurrentPolicy = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.deepEqual(concurrentPolicy.skills["skill-one"].modelInvocable, false);
  assert.deepEqual(concurrentPolicy.skills["skill-one"].userInvocable, false);

  await writeFile(join(home, "disabled.json"), JSON.stringify({ version: 999, skills: {} }), "utf8");
  omitOriginal = true;
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 500, "unsupported policy versions are rejected without migration or overwrite");
  const preservedUnsupported = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(preservedUnsupported.version, 999);
  assert.deepEqual(preservedUnsupported.skills, {});

  await writeFile(join(home, "disabled.json"), JSON.stringify({
    version: 2,
    skills: {
      "skill-one": {
        modelInvocable: false,
        userInvocable: false,
        liveFile: true,
        originalInvocation: { modelInvocable: true, userInvocable: true },
        display: { description: "Current", provider: "test-filesystem", source: "custom" },
        sourcePath: join(home, "skill-one", "SKILL.md"),
        sourceBase: { kind: "directory", path: join(home, "skill-one") }
      }
    }
  }), "utf8");
  omitOriginal = false;
  const originalWrite = PolicyStore.prototype.write;
  let failFinalWrite = true;
  PolicyStore.prototype.write = async function (value) {
    const candidate = value.skills["skill-one"];
    if (failFinalWrite && candidate?.modelInvocable === true && candidate.userInvocable === false && candidate.liveFile === true) {
      failFinalWrite = false;
      throw new Error("injected final policy write failure");
    }
    return originalWrite.call(this, value);
  };
  try {
    res = response();
    await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: true }), res);
  } finally {
    PolicyStore.prototype.write = originalWrite;
  }
  assert.equal(res.result.status, 500);
  const preservedAfterWriteFailure = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(preservedAfterWriteFailure.skills["skill-one"].modelInvocable, false);
  assert.equal(preservedAfterWriteFailure.skills["skill-one"].userInvocable, false);

  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 200);
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "user", enabled: true }), res);
  assert.equal(res.result.status, 200);

  reorderedResourceBase = true;
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: false }), res);
  assert.equal(res.result.status, 200, "resourceBase property order is not a definition conflict");
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 200);
  reorderedResourceBase = false;

  conflictingOriginal = true;
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: false }), res);
  assert.equal(res.result.status, 409);
  const conflictPolicy = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(conflictPolicy.skills["skill-one"], undefined);
  conflictingOriginal = false;
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "both", enabled: false }), res);
  assert.equal(res.result.status, 200);
  const bothDisabled = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(bothDisabled.skills["skill-one"].modelInvocable, false);
  assert.equal(bothDisabled.skills["skill-one"].userInvocable, false);

  incompleteSnapshot = true;
  res = response();
  await setRoute(request("POST", { name: "skill-one", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 500, "original bodies are never read from an incomplete Registry view");
  const preservedIncomplete = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(preservedIncomplete.skills["skill-one"].modelInvocable, false);
  assert.equal(preservedIncomplete.skills["skill-one"].userInvocable, false);
  incompleteSnapshot = false;

  skillTwoInvocation = { modelInvocable: false, userInvocable: true };
  res = response();
  await setRoute(request("POST", { name: "skill-two", channel: "user", enabled: false }), res);
  assert.equal(res.result.status, 200);
  const originalFlags = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(originalFlags.skills["skill-two"].modelInvocable, false);
  assert.equal(originalFlags.skills["skill-two"].userInvocable, false);
  assert.deepEqual(originalFlags.skills["skill-two"].originalInvocation, {
    modelInvocable: false,
    userInvocable: true
  });
  res = response();
  await setRoute(request("POST", { name: "skill-two", channel: "user", enabled: true }), res);
  assert.equal(res.result.status, 200);
  const restoredOriginal = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(restoredOriginal.skills["skill-two"], undefined);
  res = response();
  await setRoute(request("POST", { name: "skill-two", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 200);
  const enabledOriginal = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(enabledOriginal.skills["skill-two"].modelInvocable, true);
  assert.equal(enabledOriginal.skills["skill-two"].userInvocable, true);
  assert.equal(enabledOriginal.skills["skill-two"].originalInvocation.modelInvocable, false);
  assert.equal(enabledOriginal.skills["skill-two"].liveFile, true);
  assert.equal(enabledOriginal.skills["skill-two"].sourcePath, join(home, "skill-two", "SKILL.md"));
  res = response();
  await setRoute(request("POST", { name: "skill-two", channel: "model", enabled: false }), res);
  assert.equal(res.result.status, 200);
  assert.equal(JSON.parse(await readFile(join(home, "disabled.json"), "utf8")).skills["skill-two"], undefined);
  skillTwoInvocation = { modelInvocable: true, userInvocable: true };

  includeFileSkill = true;
  res = response();
  await setRoute(request("POST", { name: "file-skill", channel: "model", enabled: false }), res);
  assert.equal(res.result.status, 200);
  const liveFilePolicy = JSON.parse(await readFile(join(home, "disabled.json"), "utf8")).skills["file-skill"];
  assert.equal(liveFilePolicy.sourcePath, join(home, "file-skill", "SKILL.md"));
  assert.deepEqual(liveFilePolicy.sourceBase, { kind: "directory", path: join(home, "file-skill") });
  assert.equal(liveFilePolicy.liveFile, true);
  assert.equal(liveFilePolicy.snapshot, undefined, "file-backed policies do not persist a body snapshot");
  res = response();
  await setRoute(request("POST", { name: "file-skill", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 200);
  includeFileSkill = true;
  await writeFile(join(home, "file-skill", "SKILL.md"), "not a valid Skill document", "utf8");
  res = response();
  await setRoute(request("POST", { name: "file-skill", channel: "both", enabled: false }), res);
  assert.equal(res.result.status, 409, "an invalid provider-file cannot become a policy even when both channels are off");
  assert.equal(JSON.parse(res.result.body).code, "invalid-file-source");
  assert.doesNotMatch(JSON.parse(res.result.body).error, /SKILL\.md|file-skill|[A-Za-z]:[\\/]/, "validation errors never leak source paths");
  await rm(join(home, "file-skill", "SKILL.md"), { force: true });
  res = response();
  await setRoute(request("POST", { name: "file-skill", channel: "both", enabled: false }), res);
  assert.equal(res.result.status, 409, "a missing provider-file is rejected before any policy write");
  assert.equal(JSON.parse(res.result.body).code, "invalid-file-source");
  assert.equal(JSON.parse(await readFile(join(home, "disabled.json"), "utf8")).skills["file-skill"], undefined);
  includeFileSkill = false;

  const withMissingPolicy = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  withMissingPolicy.skills["ghost-skill"] = {
    modelInvocable: false,
    userInvocable: false,
    liveFile: true,
    originalInvocation: { modelInvocable: true, userInvocable: true },
    display: { description: "Ghost", provider: "filesystem", source: "user-dsh" },
    sourcePath: "D:/missing/ghost-skill/SKILL.md",
    sourceBase: { kind: "directory", path: "D:/missing/ghost-skill" }
  };
  await writeFile(join(home, "disabled.json"), JSON.stringify(withMissingPolicy), "utf8");
  res = response();
  await listRoute(request("GET"), res);
  assert.equal(res.result.status, 200);
  assert.equal(JSON.parse(res.result.body).skills.find((row) => row.name === "ghost-skill").missing, true);
  res = response();
  await setRoute(request("POST", { name: "ghost-skill", channel: "model", enabled: true }), res);
  assert.equal(res.result.status, 409, "a missing original cannot be re-enabled without a current source");
  const preservedGhost = JSON.parse(await readFile(join(home, "disabled.json"), "utf8")).skills["ghost-skill"];
  assert.equal(preservedGhost.modelInvocable, false);
  assert.equal(preservedGhost.userInvocable, false);
  assert.equal(preservedGhost.liveFile, true);
  assert.equal(preservedGhost.sourcePath, "D:/missing/ghost-skill/SKILL.md");
  res = response();
  await listRoute(request("GET"), res);
  assert.equal(JSON.parse(res.result.body).skills.find((row) => row.name === "ghost-skill").missing, true);

  res = response();
  await setRoute(request("POST", { name: "skill-one", action: "remove" }), res);
  assert.equal(res.result.status, 409, "a loaded original cannot be removed through the missing-policy action");
  assert.ok(JSON.parse(await readFile(join(home, "disabled.json"), "utf8")).skills["skill-one"]);
  res = response();
  await setRoute(request("POST", { name: "ghost-skill", action: "remove" }), res);
  assert.equal(res.result.status, 200);
  assert.equal(JSON.parse(res.result.body).removed, true);
  const removedGhost = JSON.parse(await readFile(join(home, "disabled.json"), "utf8"));
  assert.equal(removedGhost.skills["ghost-skill"], undefined);
  assert.ok(removedGhost.skills["skill-one"], "deleting one missing entry preserves every other policy");
  res = response();
  await setRoute(request("POST", { name: "ghost-skill", action: "remove" }), res);
  assert.equal(res.result.status, 409, "repeated deletion is rejected instead of touching unrelated state");
  res = response();
  await listRoute(request("GET"), res);
  assert.equal(JSON.parse(res.result.body).skills.some((row) => row.name === "ghost-skill"), false);

  failingAcquire = true;
  res = response();
  await listRoute(request("GET"), res);
  assert.equal(res.result.status, 500, "a cold preset scope never degrades to the global view");
  failingAcquire = false;

  incompleteSnapshot = true;
  res = response();
  await listRoute(request("GET"), res);
  assert.equal(res.result.status, 500, "partial current Registry snapshots fail the whole inventory");
  incompleteSnapshot = false;

  failingList = true;
  res = response();
  await listRoute(request("GET"), res);
  assert.equal(res.result.status, 500);
});