import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(relative) {
  return readFile(new URL(`../${relative}`, import.meta.url), "utf8");
}

test("documentation defaults to English with a Chinese switch and consistent naming", async () => {
  const [en, zh, manifest, license] = await Promise.all([
    read("README.md"),
    read("README.zh-CN.md"),
    read("package.json").then(JSON.parse),
    read("LICENSE")
  ]);
  assert.match(en, /^# DSH Skills Management/m);
  assert.match(zh, /^# DSH 技能管理/m);
  assert.match(en, /English \| \[简体中文\]\(README\.zh-CN\.md\)/);
  assert.match(en, /Skills from every Provider remain visible/);
  assert.match(en, /user manual invocation \(`\/name`\)/);
  assert.match(en, /Bundled Provider assets are read-only/);
  assert.doesNotMatch(en, /provider file|no longer/i);
  assert.doesNotMatch(en, /(?<!user )manual invocation/i);
  assert.match(zh, /\[English\]\(README\.md\) \| 简体中文/);
  assert.match(zh, /所有 Provider 的 Skill 都可展示/);
  assert.match(zh, /用户手动调用（`\/名称`）/);
  assert.match(zh, /内置资源/);
  assert.doesNotMatch(zh, /插件文件|不再/);
  assert.doesNotMatch(zh, /(?<!用户)手动调用/);
  assert.doesNotMatch(zh, /面向 \*\*文件型 Skill|用户\s*\//);
  assert.notEqual(en, zh);
  assert.ok(manifest.files.includes("README.md"));
  assert.ok(manifest.files.includes("README.zh-CN.md"));
  assert.ok(manifest.files.includes("docs/"));
  const screenshotPath = "docs/images/skills-management-ui.png";
  assert.ok(en.includes(`](${screenshotPath})`));
  assert.ok(zh.includes(`](${screenshotPath})`));
  const screenshot = await readFile(new URL(`../${screenshotPath}`, import.meta.url));
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(license, /dsh-skills-management contributors/);
  assert.doesNotMatch(license, /dsh-skill-policy/);
});
