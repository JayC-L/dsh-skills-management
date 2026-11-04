import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyStore } from "../lib/policy-store.js";
import { createPolicyProvider } from "../lib/policy-provider.js";
import { mergeInventory } from "../lib/inventory.js";
import { createLiveSkillLoader } from "../lib/live-file.js";

test("real DSH Registry controls each channel while keeping the alternate body", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-registry-"));
  const sourceFile = join(directory, "SKILL.md");
  const source = "---\nname: demo-skill\ndescription: Demo\n---\n\nOriginal body.\n";
  await writeFile(sourceFile, source, "utf8");
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await ctx.plugin(SkillRegistry);
  const registry = ctx.get("skills");
  const candidate = {
    name: "demo-skill",
    description: "Demo",
    provider: "test-original",
    source: "custom",
    rank: 300,
    invocation: { modelInvocable: true, userInvocable: true },
    path: sourceFile
  };
  registry.registerProvider(() => ({
    name: "test-original",
    list: async () => [candidate],
    get: async () => ({
      name: candidate.name,
      description: candidate.description,
      provider: candidate.provider,
      source: candidate.source,
      invocation: candidate.invocation,
      path: sourceFile,
      content: "Original body."
    })
  }));
  const store = new PolicyStore(join(directory, "policy", "disabled.json"));
  const invalidators = new Set();
  const loadLive = createLiveSkillLoader({
    dshHome: join(directory, ".dsh"),
    agentsHome: join(directory, ".agents"),
    getCustomSkillDirs: () => [directory]
  });
  registry.registerProvider((control) => {
    invalidators.add(control.invalidate);
    return createPolicyProvider(store, console, loadLive);
  });

  const before = await registry.list();
  assert.deepEqual(before[0].invocation, { modelInvocable: true, userInvocable: true });
  assert.equal((await registry.get("demo-skill")).content, "Original body.");

  const common = {
    display: {
      description: candidate.description,
      provider: candidate.provider,
      source: candidate.source
    },
    liveFile: true,
    sourcePath: sourceFile,
    sourceBase: { kind: "directory", path: directory }
  };
  await store.update("demo-skill", { ...common, modelInvocable: false, userInvocable: true });
  for (const invalidate of invalidators) invalidate();
  const modelOff = await registry.list();
  assert.equal(modelOff.length, 1, "management registry still retains the restricted row");
  assert.deepEqual(modelOff[0].invocation, { modelInvocable: false, userInvocable: true });
  assert.equal(modelOff[0].provider, "dsh-skills-management");
  assert.equal((await registry.get("demo-skill")).content, "Original body.");
  assert.equal(await readFile(sourceFile, "utf8"), source);

  await store.update("demo-skill", { ...common, modelInvocable: true, userInvocable: false });
  for (const invalidate of invalidators) invalidate();
  const userOff = await registry.list();
  assert.deepEqual(userOff[0].invocation, { modelInvocable: true, userInvocable: false });
  assert.equal((await registry.get("demo-skill")).content, "Original body.");

  await store.remove("demo-skill");
  for (const invalidate of invalidators) invalidate();
  const restored = await registry.list();
  assert.deepEqual(restored[0].invocation, { modelInvocable: true, userInvocable: true });
  assert.equal((await registry.get("demo-skill")).content, "Original body.");
  assert.equal(await readFile(sourceFile, "utf8"), source);
});

test("real Registry overlays preserve evidence-based missing file entries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-missing-"));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await ctx.plugin(SkillRegistry);
  const registry = ctx.get("skills");
  const store = new PolicyStore(join(directory, "disabled.json"));
  const invalidators = new Set();
  const loadLive = createLiveSkillLoader({
    dshHome: join(directory, ".dsh"),
    agentsHome: join(directory, ".agents"),
    getCustomSkillDirs: () => []
  });
  registry.registerProvider((control) => {
    invalidators.add(control.invalidate);
    return createPolicyProvider(store, console, loadLive);
  });
  const display = { description: "File skill", provider: "filesystem", source: "user-dsh" };
  const presentPath = join(directory, "present.md");
  await writeFile(presentPath, "---\nname: present-skill\ndescription: File skill\n---\n\nPresent body.\n", "utf8");
  await store.update("deleted-skill", {
    modelInvocable: false,
    userInvocable: true,
    liveFile: true,
    display,
    sourcePath: join(directory, "deleted.md"),
    sourceBase: { kind: "directory", path: directory }
  });
  await store.update("present-skill", {
    modelInvocable: false,
    userInvocable: false,
    liveFile: true,
    display,
    sourcePath: join(directory, "present.md"),
    sourceBase: { kind: "directory", path: directory }
  });
  const registrySkills = await registry.list();
  assert.equal(registrySkills.length, 2);
  assert.ok(registrySkills.every((skill) => skill.provider === "dsh-skills-management"));
  store.replaceMissing(["deleted-skill"]);
  for (const invalidate of invalidators) invalidate();
  const restricted = await registry.list();
  assert.deepEqual(restricted.find((skill) => skill.name === "deleted-skill").invocation, {
    modelInvocable: false,
    userInvocable: false
  });
  assert.doesNotMatch((await registry.get("deleted-skill")).content, /Deleted original body/);
  const rows = mergeInventory({
    views: [{
      registrySkills,
      fileSkills: []
    }, {
      registrySkills: [],
      fileSkills: [{
        name: "present-skill",
        description: "File skill",
        provider: "filesystem",
        source: "user-dsh",
        rank: 400,
        invocation: { modelInvocable: true, userInvocable: true },
        path: presentPath,
        fileState: "file"
      }]
    }],
    policyEntries: (await store.read()).skills
  });
  const deleted = rows.find((row) => row.name === "deleted-skill");
  assert.equal(deleted.missing, true);
  assert.equal(deleted.source, "missing");
  const present = rows.find((row) => row.name === "present-skill");
  assert.equal(present.missing, false);
  assert.equal(present.fileState, "file");
  assert.equal(present.path, presentPath);
});

test("real Registry receives the current file body on every live policy read", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-live-registry-"));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await ctx.plugin(SkillRegistry);
  const registry = ctx.get("skills");
  const sourceFile = join(directory, "SKILL.md");
  const writeSource = async (description, body) => {
    await writeFile(sourceFile, `---\nname: live-skill\ndescription: ${description}\n---\n\n${body}\n`, "utf8");
  };
  await writeSource("First", "First current body");
  const store = new PolicyStore(join(directory, "disabled.json"));
  await store.update("live-skill", {
    modelInvocable: false,
    userInvocable: true,
    display: { description: "First", provider: "filesystem", source: "custom" },
    liveFile: true,
    sourcePath: sourceFile,
    sourceBase: { kind: "directory", path: directory }
  });
  const loadLive = createLiveSkillLoader({
    dshHome: join(directory, ".dsh"),
    agentsHome: join(directory, ".agents"),
    getCustomSkillDirs: () => [directory]
  });
  const invalidators = new Set();
  registry.registerProvider((control) => {
    invalidators.add(control.invalidate);
    return createPolicyProvider(store, console, loadLive);
  });
  const rows = await registry.list();
  assert.deepEqual(rows[0].invocation, { modelInvocable: false, userInvocable: true });
  assert.equal((await registry.get("live-skill")).content, "First current body");
  await writeSource("Second", "Second current body");
  for (const invalidate of invalidators) invalidate();
  const updatedRows = await registry.list();
  assert.equal(updatedRows.find((row) => row.name === "live-skill").description, "Second");
  assert.equal(updatedRows.find((row) => row.name === "live-skill").path, sourceFile);
  const updated = await registry.get("live-skill");
  assert.equal(updated.content, "Second current body");
  assert.equal(updated.description, "Second");
  assert.deepEqual(updated.resourceBase, { kind: "directory", path: directory });

  registry.registerProvider(() => ({
    name: "remote",
    list: async () => [{ name: "remote-custom", description: "Remote", provider: "remote", source: "runtime", rank: 250 }],
    get: async () => ({ name: "remote-custom", description: "Remote", provider: "remote", source: "runtime", invocation: { modelInvocable: true, userInvocable: true }, content: "Runtime body" })
  }));
  await store.update("remote-custom", {
    modelInvocable: false,
    userInvocable: true,
    display: { description: "Remote", provider: "remote", source: "runtime" }
  });
  for (const invalidate of invalidators) invalidate();
  const remote = await registry.get("remote-custom");
  assert.equal(remote.content, "Runtime body", "non-file providers remain independent of file policy");
  assert.deepEqual(remote.invocation, { modelInvocable: true, userInvocable: true });
});
