import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { createScope } from "@deepseek-ai/dsh-scope";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyStore } from "../lib/policy-store.js";
import { createPolicyProvider } from "../lib/policy-provider.js";
import { createLiveSkillLoader } from "../lib/live-file.js";

test("standard-style scoped skills need and receive their own policy provider", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-scope-"));
  const sourceFile = join(directory, "session-skill.md");
  await writeFile(sourceFile, "---\nname: session-skill\ndescription: Session skill\n---\n\nSession body\n", "utf8");
  const ctx = new Context();
  const scopeKey = { id: "agent-standard" };
  const scoped = createScope(ctx, scopeKey);
  t.after(async () => {
    await scoped.dispose();
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await ctx.plugin(SkillRegistry);
  const globalRegistry = ctx.get("skills");
  const scopedRegistry = scoped.ctx.get("skills");
  const candidate = {
    name: "session-skill",
    description: "Session skill",
    provider: "test-session",
    source: "project-dsh",
    rank: 100,
    invocation: { modelInvocable: true, userInvocable: true },
    path: sourceFile
  };
  scopedRegistry.registerProvider(() => ({
    name: "test-session",
    list: async () => [candidate],
    get: async () => ({ ...candidate, content: "Session body" })
  }));
  const store = new PolicyStore(join(directory, "disabled.json"));
  const invalidators = new Set();
  const loadLive = createLiveSkillLoader({
    dshHome: join(directory, ".dsh"),
    agentsHome: join(directory, ".agents"),
    getCustomSkillDirs: () => [directory]
  });
  const registerPolicy = (registry) => registry.registerProvider((control) => {
    invalidators.add(control.invalidate);
    return createPolicyProvider(store, console, loadLive);
  });
  registerPolicy(globalRegistry);

  const entry = {
    modelInvocable: false,
    userInvocable: true,
    display: {
      description: candidate.description,
      provider: candidate.provider,
      source: candidate.source
    },
    liveFile: true,
    sourcePath: sourceFile,
    sourceBase: { kind: "directory", path: directory }
  };
  await store.update("session-skill", entry);
  for (const invalidate of invalidators) invalidate();
  const globalOnly = await scopedRegistry.list({ scope: scopeKey });
  assert.deepEqual(globalOnly[0].invocation, { modelInvocable: true, userInvocable: true },
    "the nearer session layer wins when no session policy is attached");

  registerPolicy(scopedRegistry);
  for (const invalidate of invalidators) invalidate();
  const restricted = await scopedRegistry.list({ scope: scopeKey });
  assert.equal(restricted.length, 1);
  assert.deepEqual(restricted[0].invocation, { modelInvocable: false, userInvocable: true });
  assert.equal((await scopedRegistry.get("session-skill", { scope: scopeKey })).content, "Session body");

  await store.remove("session-skill");
  for (const invalidate of invalidators) invalidate();
  const restored = await scopedRegistry.list({ scope: scopeKey });
  assert.deepEqual(restored[0].invocation, { modelInvocable: true, userInvocable: true });
});
