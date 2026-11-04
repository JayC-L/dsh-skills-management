import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyStore } from "../lib/policy-store.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-management-store-"));
  return {
    directory,
    file: join(directory, "disabled.json"),
    async close() { await rm(directory, { recursive: true, force: true }); }
  };
}

test("independent channels write only the external policy file", async () => {
  const f = await fixture();
  try {
    const store = new PolicyStore(f.file);
    assert.deepEqual(await store.read(), { version: 2, skills: {} });
    await store.update("z-skill", {
      modelInvocable: false,
      userInvocable: true,
      liveFile: true
    });
    await store.update("a-skill", {
      modelInvocable: true,
      userInvocable: false,
      liveFile: true
    });
    assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), {
      version: 2,
      skills: {
        "a-skill": { modelInvocable: true, userInvocable: false, liveFile: true },
        "z-skill": { modelInvocable: false, userInvocable: true, liveFile: true }
      }
    });
    await store.remove("z-skill");
    assert.deepEqual(Object.keys((await store.read()).skills), ["a-skill"]);
    assert.deepEqual(await readdir(f.directory), ["disabled.json"]);
  } finally {
    await f.close();
  }
});

test("a fully enabled entry is removed rather than stored", async () => {
  const f = await fixture();
  try {
    const store = new PolicyStore(f.file);
    const result = await store.update("demo", { modelInvocable: true, userInvocable: true });
    assert.deepEqual(result.skills, {});
    await assert.rejects(readFile(f.file, "utf8"), /ENOENT/);
  } finally {
    await f.close();
  }
});

test("invalid names and invocation flags are rejected without a file", async () => {
  const f = await fixture();
  try {
    const store = new PolicyStore(f.file);
    await assert.rejects(store.update("../outside", { modelInvocable: false, userInvocable: true }), /invalid skill name/);
    await assert.rejects(store.update("valid-skill", { modelInvocable: "no", userInvocable: true }), /booleans/);
    await assert.rejects(readFile(f.file, "utf8"), /ENOENT/);
  } finally {
    await f.close();
  }
});

test("a fresh reader never overwrites corrupt policy JSON", async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, "{broken", "utf8");
    const store = new PolicyStore(f.file);
    await assert.rejects(store.read());
    await assert.rejects(store.update("another-skill", { modelInvocable: false, userInvocable: true }));
    assert.equal(await readFile(f.file, "utf8"), "{broken");
  } finally {
    await f.close();
  }
});

test("a running store reads the last valid state but never overwrites corrupt JSON", async () => {
  const f = await fixture();
  try {
    const store = new PolicyStore(f.file);
    await store.update("known-skill", { modelInvocable: false, userInvocable: true, liveFile: true });
    await writeFile(f.file, "{broken", "utf8");
    assert.equal((await store.read()).skills["known-skill"].modelInvocable, false);
    await assert.rejects(store.update("another-skill", { modelInvocable: false, userInvocable: true }));
    assert.equal(await readFile(f.file, "utf8"), "{broken");
  } finally {
    await f.close();
  }
});

test("unsupported policy versions fail closed without writes", async () => {
  const f = await fixture();
  try {
    const raw = JSON.stringify({ version: 999, skills: {} });
    await writeFile(f.file, raw, "utf8");
    const store = new PolicyStore(f.file);
    await assert.rejects(store.read(), /unsupported skill policy version: 999/);
    await assert.rejects(
      store.update("current-skill", { modelInvocable: false, userInvocable: true, liveFile: true }),
      /unsupported skill policy version: 999/
    );
    assert.equal(await readFile(f.file, "utf8"), raw);
  } finally {
    await f.close();
  }
});

test("semantically corrupt display metadata fails closed for writes", async () => {
  const f = await fixture();
  try {
    const raw = JSON.stringify({
      version: 2,
      skills: {
        demo: {
          modelInvocable: false,
          userInvocable: true,
          display: { description: "" }
        }
      }
    });
    await writeFile(f.file, raw, "utf8");
    const store = new PolicyStore(f.file);
    await assert.rejects(store.read(), /description/);
    await assert.rejects(store.update("another-skill", { modelInvocable: false, userInvocable: true }));
    assert.equal(await readFile(f.file, "utf8"), raw);
  } finally {
    await f.close();
  }
});