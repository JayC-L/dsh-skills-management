import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyStore } from "../lib/policy-store.js";

test("display and source metadata are retained until fully restored", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-metadata-"));
  try {
    const file = join(directory, "disabled.json");
    const store = new PolicyStore(file);
    await store.update("demo", {
      modelInvocable: false,
      userInvocable: true,
      originalInvocation: { modelInvocable: false, userInvocable: false },
      display: {
        description: "Demo",
        provider: "filesystem",
        source: "project-dsh",
        whenToUse: "Use for demos"
      },
      liveFile: true,
      sourcePath: "D:/skills/demo/SKILL.md",
      sourceBase: { kind: "directory", path: "D:/skills/demo" }
    });
    const policy = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(policy.skills.demo.originalInvocation, { modelInvocable: false, userInvocable: false });
    assert.deepEqual(policy.skills.demo.display, {
      description: "Demo",
      provider: "filesystem",
      source: "project-dsh",
      whenToUse: "Use for demos"
    });
    assert.equal(policy.skills.demo.liveFile, true);
    assert.equal(policy.skills.demo.sourcePath, "D:/skills/demo/SKILL.md");
    assert.deepEqual(policy.skills.demo.sourceBase, { kind: "directory", path: "D:/skills/demo" });
    await store.remove("demo");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 2, skills: {} });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});