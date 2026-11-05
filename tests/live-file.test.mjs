import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PolicyStore } from "../lib/policy-store.js";
import { createPolicyProvider } from "../lib/policy-provider.js";
import { createLiveSkillLoader } from "../lib/live-file.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-live-file-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const dshHome = join(directory, ".dsh");
  const agentsHome = join(directory, ".agents");
  const custom = join(directory, "custom");
  return {
    directory,
    dshHome,
    agentsHome,
    custom,
    store: new PolicyStore(join(directory, "disabled.json")),
    loadLive: createLiveSkillLoader({
      dshHome,
      agentsHome,
      getCustomSkillDirs: () => [custom]
    })
  };
}

async function writeSkill(path, name, description, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, "utf8");
}

test("live file entries reread current content and preserve resource guidance", async (t) => {
  const f = await fixture(t);
  const source = join(f.directory, "source", "demo", "SKILL.md");
  const resourceBase = { kind: "directory", path: join(f.directory, "source", "demo") };
  await writeSkill(source, "demo", "Version one", "Read [reference](references/info.md).\n\nVersion one.");
  await writeSkill(join(f.directory, "source", "demo", "references", "info.md"), "ignored", "ignored", "Reference stays here.");
  await f.store.update("demo", {
    modelInvocable: false,
    userInvocable: true,
    liveFile: true,
    originalInvocation: { modelInvocable: true, userInvocable: true },
    display: { description: "Version one", provider: "filesystem", source: "user-dsh", whenToUse: "Stored usage" },
    sourcePath: source,
    sourceBase: resourceBase
  });
  const provider = createPolicyProvider(f.store, console, f.loadLive);
  const row = (await provider.list())[0];
  assert.equal(row.whenToUse, undefined, "a removed field must not leak from stored display metadata");
  const first = await provider.get(row);
  assert.equal(first.whenToUse, undefined);
  assert.match(first.content, /Version one/);
  assert.deepEqual(first.resourceBase, resourceBase);
  await writeSkill(source, "demo", "Version two", "Read [reference](references/info.md).\n\nVersion two.");
  const updatedRow = (await provider.list())[0];
  assert.equal(updatedRow.description, "Version two");
  assert.equal(updatedRow.whenToUse, undefined);
  assert.equal(updatedRow.path, source);
  assert.deepEqual(updatedRow.invocation, { modelInvocable: false, userInvocable: true });
  const second = await provider.get(updatedRow);
  assert.match(second.content, /Version two/);
  assert.equal(second.description, "Version two");
  assert.deepEqual(second.resourceBase, resourceBase);
  assert.match(await readFile(join(f.directory, "source", "demo", "references", "info.md"), "utf8"), /Reference stays here/);
  const stored = JSON.parse(await readFile(join(f.directory, "disabled.json"), "utf8")).skills.demo;
  assert.equal(stored.sourcePath, source);
  assert.deepEqual(stored.sourceBase, resourceBase);
  assert.equal(stored.snapshot, undefined);
  const staleBase = { kind: "directory", path: join(f.directory, "moved-away", "demo") };
  await f.store.update("demo", { ...stored, sourceBase: staleBase });
  const recovered = await provider.get(updatedRow);
  assert.deepEqual(recovered.resourceBase, resourceBase, "a missing stored base falls back to the current source directory");
  const persisted = JSON.parse(await readFile(join(f.directory, "disabled.json"), "utf8")).skills.demo;
  assert.deepEqual(persisted.sourceBase, staleBase, "live reads never rewrite policy paths");
});

test("source metadata locates current directory bundles and flat files", async (t) => {
  const f = await fixture(t);
  const directorySource = join(f.dshHome, "skills", "bundle");
  await writeSkill(join(directorySource, "SKILL.md"), "bundle", "Bundle", "Current directory body");
  const flatSource = join(f.custom, "alias.md");
  await writeSkill(flatSource, "flat-skill", "Flat", "Current flat body");
  await f.store.update("bundle", {
    modelInvocable: false,
    userInvocable: true,
    liveFile: true,
    display: { description: "Bundle", provider: "filesystem", source: "user-dsh" },
    sourceBase: { kind: "directory", path: directorySource }
  });
  await f.store.update("flat-skill", {
    modelInvocable: false,
    userInvocable: true,
    liveFile: true,
    display: { description: "Flat", provider: "filesystem", source: "custom" },
    sourceBase: { kind: "directory", path: f.custom }
  });
  const provider = createPolicyProvider(f.store, console, f.loadLive);
  const rows = await provider.list();
  const bundle = await provider.get(rows.find((row) => row.name === "bundle"));
  const flat = await provider.get(rows.find((row) => row.name === "flat-skill"));
  assert.equal(bundle.content, "Current directory body");
  assert.equal(flat.content, "Current flat body");
  assert.equal(flat.resourceBase.path, f.custom);
});

test("live list disables a missing file and recovers when it returns", async (t) => {
  const f = await fixture(t);
  const directory = join(f.dshHome, "skills", "missing");
  const source = join(directory, "SKILL.md");
  await f.store.update("missing", {
    modelInvocable: false,
    userInvocable: true,
    liveFile: true,
    display: { description: "Missing", provider: "filesystem", source: "user-dsh" },
    sourcePath: source,
    sourceBase: { kind: "directory", path: directory }
  });
  const provider = createPolicyProvider(f.store, console, f.loadLive);
  const missingRow = (await provider.list())[0];
  assert.deepEqual(missingRow.invocation, { modelInvocable: false, userInvocable: false });
  assert.doesNotMatch((await provider.get(missingRow)).content, /Stale body/);
  await writeSkill(source, "missing", "Recovered", "Recovered current body");
  const recoveredRow = (await provider.list())[0];
  assert.deepEqual(recoveredRow.invocation, { modelInvocable: false, userInvocable: true });
  assert.equal(recoveredRow.description, "Recovered");
  assert.equal((await provider.get(recoveredRow)).content, "Recovered current body");
});

test("non-file providers are never overlaid by file policy", async (t) => {
  const f = await fixture(t);
  await f.store.update("runtime-skill", {
    modelInvocable: false,
    userInvocable: true,
    display: { description: "Runtime", provider: "remote", source: "runtime" }
  });
  const provider = createPolicyProvider(f.store, console, f.loadLive);
  assert.deepEqual(await provider.list(), []);
  assert.equal(await provider.get({ name: "runtime-skill" }), undefined);
});
