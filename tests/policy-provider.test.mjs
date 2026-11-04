import test from "node:test";
import assert from "node:assert/strict";
import { createPolicyProvider, POLICY_PROVIDER, POLICY_RANK } from "../lib/policy-provider.js";

test("each invocation channel is overridden independently", async () => {
  const provider = createPolicyProvider({
    read: async () => ({
      version: 2,
      skills: {
        "model-off": {
          modelInvocable: false,
          userInvocable: true,
          liveFile: true,
          display: { description: "Model off", provider: "filesystem", source: "project-dsh" },
          sourcePath: "D:/skills/model-off/SKILL.md"
        },
        "user-off": {
          modelInvocable: true,
          userInvocable: false,
          liveFile: true,
          display: { description: "User off", provider: "filesystem" },
          sourcePath: "D:/skills/user-off/SKILL.md"
        }
      }
    })
  }, console, async ({ name, entry }) => ({
    description: entry.display.description,
    path: `D:/skills/${name}/SKILL.md`,
    resourceBase: { kind: "directory", path: `D:/skills/${name}` },
    content: name === "model-off" ? "Original body" : "Another body"
  }));
  const rows = await provider.list();
  assert.equal(rows.length, 2);
  const modelOff = rows.find((row) => row.name === "model-off");
  assert.equal(modelOff.rank, POLICY_RANK);
  assert.equal(modelOff.provider, POLICY_PROVIDER);
  assert.equal(modelOff.source, "project-dsh");
  assert.deepEqual(modelOff.invocation, { modelInvocable: false, userInvocable: true });
  const definition = await provider.get(modelOff);
  assert.equal(definition.content, "Original body");
  assert.deepEqual(definition.invocation, { modelInvocable: false, userInvocable: true });
  const userOff = await provider.get(rows.find((row) => row.name === "user-off"));
  assert.equal(userOff.content, "Another body");
  assert.deepEqual(userOff.invocation, { modelInvocable: true, userInvocable: false });
});

test("a fully disabled entry never exposes the original body", async () => {
  const provider = createPolicyProvider({
    read: async () => ({
      version: 2,
      skills: {
        demo: {
          modelInvocable: false,
          userInvocable: false,
          liveFile: true,
          sourcePath: "D:/skills/demo/SKILL.md"
        }
      }
    })
  }, console, async () => ({
    description: "Demo",
    path: "D:/skills/demo/SKILL.md",
    content: "Sensitive original body"
  }));
  const rows = await provider.list();
  const definition = await provider.get(rows[0]);
  assert.deepEqual(definition.invocation, { modelInvocable: false, userInvocable: false });
  assert.doesNotMatch(definition.content, /Sensitive original body/);
});

test("an empty policy emits no overlays", async () => {
  const provider = createPolicyProvider({ read: async () => ({ version: 2, skills: {} }) });
  assert.deepEqual(await provider.list(), []);
});

test("a corrupt store fails open without overwriting or disabling skills", async () => {
  const warnings = [];
  const provider = createPolicyProvider({
    read: async () => { throw new SyntaxError("broken"); }
  }, { warn: (line) => warnings.push(line) });
  assert.deepEqual(await provider.list(), []);
  assert.equal(warnings.length, 1);
});

test("an empty stored description cannot invalidate the Registry catalog", async () => {
  const provider = createPolicyProvider({
    read: async () => ({
      version: 2,
      skills: {
        demo: {
          modelInvocable: false,
          userInvocable: false,
          liveFile: true,
          display: { description: "" }
        }
      }
    })
  });
  const rows = await provider.list();
  assert.ok(rows[0].description.length > 0);
  assert.ok((await provider.get(rows[0])).description.length > 0);
});