import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

function effectOwner() {
  const disposers = new Set();
  return {
    effect(callback) {
      const cleanup = callback();
      let active = true;
      const dispose = () => {
        if (!active) return;
        active = false;
        disposers.delete(dispose);
        if (typeof cleanup === "function") cleanup();
      };
      disposers.add(dispose);
      return dispose;
    },
    dispose() {
      for (const dispose of [...disposers]) dispose();
    }
  };
}

function registryFixture() {
  const providers = new Set();
  return {
    providers,
    async list() { return []; },
    registerProvider(create) {
      const provider = create({ invalidate() {} });
      providers.add(provider);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        providers.delete(provider);
      };
    }
  };
}

test("agent teardown and plugin unload both restore original registries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-lifecycle-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const rootEffects = effectOwner();
  const firstEffects = effectOwner();
  const secondEffects = effectOwner();
  const globalRegistry = registryFixture();
  const firstRegistry = registryFixture();
  const secondRegistry = registryFixture();
  const makeAgent = (id, effects, registry) => ({
    id,
    ctx: {
      logger: console,
      effect: effects.effect,
      get(name) { return name === "skills" ? registry : undefined; }
    }
  });
  const first = makeAgent("first", firstEffects, firstRegistry);
  const second = makeAgent("second", secondEffects, secondRegistry);
  const ctx = {
    logger: console,
    effect: rootEffects.effect,
    get(name) { return name === "skills" ? globalRegistry : undefined; },
    agents: { list: () => [first, second], get: () => undefined },
    sessions: { list: () => [] },
    workingDirectory: { defaultDirectory: directory },
    webServer: { register: () => () => {} },
    on: () => () => {},
    emit() {}
  };
  apply(ctx, {
    dshHome: directory,
    agentsHome: directory,
    policyFile: join(directory, "disabled.json")
  });
  assert.equal(globalRegistry.providers.size, 1);
  assert.equal(firstRegistry.providers.size, 1);
  assert.equal(secondRegistry.providers.size, 1);

  firstEffects.dispose();
  assert.equal(firstRegistry.providers.size, 0, "agent teardown removes only its own overlay");
  assert.equal(globalRegistry.providers.size, 1);
  assert.equal(secondRegistry.providers.size, 1);

  rootEffects.dispose();
  assert.equal(globalRegistry.providers.size, 0, "plugin unload removes the global overlay");
  assert.equal(secondRegistry.providers.size, 0, "plugin unload removes live agent overlays");

  firstEffects.dispose();
  secondEffects.dispose();
  rootEffects.dispose();
  assert.equal(firstRegistry.providers.size, 0);
  assert.equal(secondRegistry.providers.size, 0);
});
