import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeInventory, scanOfficialRoots, scanSkillRoot } from "../lib/inventory.js";

async function skill(path, name, extra = "") {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} description\n${extra}---\n\nDo work.\n`, "utf8");
}

test("only explicit DSH roots are scanned and a Junction remains visible", async () => {
  const base = await mkdtemp(join(tmpdir(), "dsh-skills-management-inventory-"));
  try {
    const project = join(base, "project");
    const dshHome = join(base, "home", ".dsh");
    const agentsHome = join(base, "home", ".agents");
    const truth = join(base, "truth", "linked-skill");
    await mkdir(join(project, ".git"), { recursive: true });
    await skill(join(project, ".dsh", "skills", "project-skill"), "project-skill");
    await skill(join(dshHome, "skills", "user-skill"), "user-skill");
    await skill(truth, "linked-skill");
    await mkdir(join(dshHome, "skills"), { recursive: true });
    await symlink(truth, join(dshHome, "skills", "linked-skill"), "junction");
    await skill(join(base, "unrelated", "never-scan-me"), "never-scan-me");

    const rows = await scanOfficialRoots({ cwd: project, dshHome, agentsHome, customSkillDirs: [] });
    const names = rows.map((row) => row.name).sort();
    assert.deepEqual(names, ["linked-skill", "project-skill", "user-skill"]);
    assert.equal(rows.find((row) => row.name === "linked-skill").linked, true);
    assert.equal(rows.find((row) => row.name === "linked-skill").source, "user-dsh");

    const shared = await scanOfficialRoots({ cwd: project, dshHome, agentsHome, customSkillDirs: [], areas: "shared" });
    assert.deepEqual(shared.map((row) => row.name).sort(), ["linked-skill", "user-skill"]);
    const projectOnly = await scanOfficialRoots({ cwd: project, dshHome, agentsHome, customSkillDirs: [], areas: "project" });
    assert.deepEqual(projectOnly.map((row) => row.name), ["project-skill"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("filesystem scanning matches DSH invocation boolean grammar", async () => {
  const base = await mkdtemp(join(tmpdir(), "dsh-skills-management-flags-"));
  try {
    const root = join(base, "skills");
    await skill(join(root, "boolean-flags"), "boolean-flags", "disable-model-invocation: YeS\nuser-invocable: \"OFF\"\n");
    await skill(join(root, "numeric-flags"), "numeric-flags", "disable-model-invocation: 0\nuser-invocable: 1\n");
    await skill(join(root, "invalid-flag"), "invalid-flag", "disable-model-invocation: perhaps\n");
    await skill(join(root, "unsupported-key"), "unsupported-key", "modelInvocable: true\n");
    await writeFile(join(root, "UPPER.MD"), "---\nname: upper-extension\ndescription: Upper\n---\n", "utf8");
    const rows = await scanSkillRoot(root, "custom");
    assert.deepEqual(rows.map((row) => row.name), ["boolean-flags", "numeric-flags"]);
    assert.deepEqual(rows[0].invocation, { modelInvocable: false, userInvocable: false });
    assert.deepEqual(rows[1].invocation, { modelInvocable: true, userInvocable: true });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("disabled rows stay in inventory and missing disabled names remain recoverable", () => {
  const fileSkills = [{
    name: "demo",
    description: "Demo",
    provider: "filesystem",
    source: "project-dsh",
    rank: 100,
    invocation: { modelInvocable: true, userInvocable: true },
    path: "D:/project/.dsh/skills/demo/SKILL.md",
    fileState: "file"
  }];
  const registrySkills = [{
    name: "demo",
    description: "Demo",
    provider: "filesystem",
    source: "project-dsh",
    rank: 99,
    invocation: { modelInvocable: false, userInvocable: false }
  }];
  const rows = mergeInventory({
    fileSkills,
    registrySkills,
    policyEntries: {
      demo: {
        modelInvocable: false,
        userInvocable: true,
        liveFile: true,
        display: { description: "Demo", provider: "filesystem", source: "project-dsh" }
      },
      "removed-skill": { modelInvocable: false, userInvocable: false, liveFile: true }
    }
  });
  const demo = rows.find((row) => row.name === "demo");
  assert.equal(demo.disabled, true);
  assert.equal(demo.fileState, "file");
  assert.equal(demo.path, "D:/project/.dsh/skills/demo/SKILL.md");
  assert.equal(demo.modelInvocable, false);
  assert.equal(demo.userInvocable, true);
  assert.equal(demo.manageable, true);
  const removed = rows.find((row) => row.name === "removed-skill");
  assert.equal(removed.missing, true);
  assert.equal(removed.disabled, true);
});

test("registry winners never inherit unrelated paths or Junction metadata", () => {
  const rows = mergeInventory({
    fileSkills: [{
      name: "cross-source",
      description: "Project file",
      provider: "filesystem",
      source: "project-dsh",
      rank: 100,
      path: "D:/project/SKILL.md",
      fileState: "file",
      linked: true
    }],
    registrySkills: [{
      name: "cross-source",
      description: "Runtime winner",
      provider: "runtime-provider",
      source: "runtime",
      rank: 100
    }, {
      name: "equal-rank",
      description: "First registration",
      provider: "first-provider",
      source: "runtime",
      path: "D:/first/SKILL.md",
      fileState: "provider-file",
      linked: true
    }, {
      name: "equal-rank",
      description: "Second registration",
      provider: "second-provider",
      source: "runtime"
    }]
  });
  const crossSource = rows.find((row) => row.name === "cross-source");
  assert.equal(crossSource.description, "Runtime winner");
  assert.equal(crossSource.path, undefined);
  assert.equal(crossSource.fileState, "virtual");
  assert.equal(crossSource.linked, false);
  const equalRank = rows.find((row) => row.name === "equal-rank");
  assert.equal(equalRank.description, "Second registration");
  assert.equal(equalRank.path, undefined);
  assert.equal(equalRank.fileState, "virtual");
  assert.equal(equalRank.linked, false);
});

test("Registry winners use source priority even when summaries have no rank", () => {
  const rows = mergeInventory({
    fileSkills: [{
      name: "demo",
      description: "User file",
      provider: "filesystem",
      source: "user-dsh",
      path: "D:/user/SKILL.md",
      fileState: "file"
    }],
    registrySkills: [{
      name: "demo",
      description: "Runtime Registry winner",
      provider: "runtime-provider",
      source: "runtime"
    }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "Runtime Registry winner");
  assert.equal(rows[0].rank, 250);
  assert.equal(rows[0].path, undefined);
  assert.equal(rows[0].fileState, "virtual");
});

test("file evidence never crosses view boundaries even for the same source", () => {
  const rows = mergeInventory({
    views: [{
      fileSkills: [],
      registrySkills: [{
        name: "demo",
        description: "Project one Registry winner",
        provider: "project-provider",
        source: "project-dsh",
        rank: 50
      }]
    }, {
      fileSkills: [{
        name: "demo",
        description: "Project two file",
        provider: "filesystem",
        source: "project-dsh",
        path: "D:/two/SKILL.md",
        fileState: "file",
        linked: true
      }],
      registrySkills: []
    }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "Project one Registry winner");
  assert.equal(rows[0].path, undefined);
  assert.equal(rows[0].fileState, "virtual");
  assert.equal(rows[0].linked, false);
});

test("non-file providers stay read-only and ignore non-file policy records", () => {
  const rows = mergeInventory({
    registrySkills: [{
      name: "runtime-skill",
      description: "Runtime",
      provider: "remote",
      source: "runtime",
      invocation: { modelInvocable: true, userInvocable: true }
    }],
    policyEntries: {
      "runtime-skill": { modelInvocable: false, userInvocable: false }
    }
  });
  assert.equal(rows[0].disabled, false);
  assert.equal(rows[0].modelInvocable, true);
  assert.equal(rows[0].userInvocable, true);
  assert.equal(rows[0].manageable, false);
});

test("live policy summaries keep current descriptions over stored display metadata", () => {
  const rows = mergeInventory({
    registrySkills: [{
      name: "live-skill",
      description: "Current description",
      whenToUse: "Current usage",
      provider: "dsh-skills-management",
      source: "user-dsh",
      path: "D:/source/live-skill/SKILL.md",
      invocation: { modelInvocable: false, userInvocable: true }
    }],
    policyEntries: {
      "live-skill": {
        modelInvocable: false,
        userInvocable: true,
        liveFile: true,
        sourcePath: "D:/source/live-skill/SKILL.md",
        display: { description: "Stored description", provider: "filesystem", source: "user-dsh", whenToUse: "Stored usage" }
      }
    }
  });
  assert.equal(rows[0].description, "Current description");
  assert.equal(rows[0].whenToUse, "Current usage");
  assert.equal(rows[0].provider, "filesystem");
  assert.equal(rows[0].source, "user-dsh");
});

test("duplicate file candidates still prove an overlay original exists", () => {
  const rows = mergeInventory({
    fileSkills: [{
      name: "duplicate-skill",
      description: "First copy",
      provider: "filesystem",
      source: "custom",
      path: "D:/one/duplicate-skill/SKILL.md",
      fileState: "file"
    }, {
      name: "duplicate-skill",
      description: "Second copy",
      provider: "filesystem",
      source: "custom",
      path: "D:/two/duplicate-skill/SKILL.md",
      fileState: "file"
    }],
    registrySkills: [{
      name: "duplicate-skill",
      description: "Restricted copy",
      provider: "dsh-skills-management",
      source: "custom",
      invocation: { modelInvocable: false, userInvocable: false }
    }],
    policyEntries: {
      "duplicate-skill": {
        modelInvocable: false,
        userInvocable: false,
        liveFile: true,
        display: { description: "Restricted copy", provider: "filesystem", source: "custom" }
      }
    }
  });
  assert.equal(rows[0].missing, false);
  assert.equal(rows[0].fileState, "virtual", "ambiguous duplicates lend no file metadata");
});

test("Registry real paths retain matching Junction evidence", () => {
  const rows = mergeInventory({
    fileSkills: [{
      name: "linked-skill",
      description: "Linked skill",
      provider: "filesystem",
      source: "user-dsh",
      path: "D:/home/.dsh/skills/linked-skill/SKILL.md",
      realPath: "D:/truth/linked-skill/SKILL.md",
      fileState: "file",
      linked: true
    }],
    registrySkills: [{
      name: "linked-skill",
      description: "Linked skill",
      provider: "filesystem",
      source: "user-dsh",
      path: "D:/truth/linked-skill/SKILL.md",
      invocation: { modelInvocable: true, userInvocable: true }
    }]
  });
  assert.equal(rows[0].path, "D:/home/.dsh/skills/linked-skill/SKILL.md");
  assert.equal(rows[0].fileState, "file");
  assert.equal(rows[0].linked, true);
});
