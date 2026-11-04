import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

async function loadClient(document) {
  let descriptor;
  const window = {
    __ModuleLoader__: {
      load(value) { descriptor = value; }
    }
  };
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  runInNewContext(source, { window, document, console });
  const client = descriptor.factory((id) => {
    if (id === "react") return { createElement: (...args) => args };
    if (id === "@deepseek-ai/dsh-client-ui-primitives") {
      return {
        Button: "Button",
        Input: "Input",
        IconRefreshOutlineRegular: "IconRefreshOutlineRegular",
        IconTrashOutlineRegular: "IconTrashOutlineRegular",
        StateDot: "StateDot",
        Switch: "Switch",
        Tag: "Tag"
      };
    }
    throw new Error(`unexpected module: ${id}`);
  });
  return client;
}

function context() {
  return {
    slots: {
      inject(_name, mount) { return mount(); },
      register() { return () => {}; }
    },
    effect(callback) { return callback(); }
  };
}

test("client replaces stale HMR style contents instead of skipping them", async () => {
  const stale = { id: "dsh-skills-management-styles", textContent: ".skp-filterbar{old:true}" };
  const document = {
    getElementById: (id) => id === stale.id ? stale : null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild() { throw new Error("existing style must be reused"); } },
    documentElement: {}
  };
  const client = await loadClient(document);
  client.apply(context());
  assert.match(stale.textContent, /\.skp-skill-row\{/);
  assert.doesNotMatch(stale.textContent, /old:true/);
});

test("client installs a namespaced style element when none exists", async () => {
  let appended;
  const document = {
    getElementById: () => null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild(style) { appended = style; } },
    documentElement: {}
  };
  const client = await loadClient(document);
  client.apply(context());
  assert.equal(appended.id, "dsh-skills-management-styles");
  assert.equal(appended.dataset.plugin, "dsh-skills-management");
  assert.equal(appended.dataset.pluginCss, "dsh-skills-management/panel.css");
  assert.match(appended.textContent, /\.skp-panel\{--skp-page-inset:clamp\(24px, 4vw, 48px\)/);
  assert.match(appended.textContent, /\.skp-panel-title\{[^}]*font-size:20px;font-weight:500;line-height:28px/);
  assert.doesNotMatch(appended.textContent, /\.skp-panel\{[^}]*font-family/);
  assert.match(appended.textContent, /\.skp-panel-intro\{[^}]*align-items:center;gap:4px;[^}]*display:flex/);
  assert.match(appended.textContent, /\.skp-filter-button\{[^}]*width:32px;height:32px/);
  assert.match(appended.textContent, /\.skp-group-cards\{[^}]*gap:2px/);
  assert.match(appended.textContent, /\.skp-list\{[^}]*margin:0 -8px/);
  assert.match(appended.textContent, /\.skp-skill-row\{border-radius:var\(--dsw-radius-xl\);min-width:0;margin:0 -8px/);
  assert.match(appended.textContent, /\.skp-fill-body\{[^}]*overflow:visible/);
  assert.match(appended.textContent, /\.skp-card-head\{align-items:center;gap:14px;padding:8px/);
  assert.match(appended.textContent, /\.skp-card-main\{[^}]*gap:4px/);
  assert.match(appended.textContent, /\.skp-status-tag\{height:18px;flex:none;padding:0 7px;font-size:10px;line-height:1/);
  assert.match(appended.textContent, /\.skp-skill-desc\{[^}]*font-size:13px;line-height:18px/);
  assert.doesNotMatch(appended.textContent, /\.skp-switch\{/);
  assert.doesNotMatch(appended.textContent, /\.skp-badge\{/);
});

test("user group is not forced into the default list and native workspace disclosure remains", async () => {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.match(source, /new Set\(\["bundled"\]\)/);
  assert.match(source, /sourceFilter !== "all"\) groups\.set\(sourceFilter, \[\]\)/);
  assert.doesNotMatch(source, /sourceFilter === "all" \|\| sourceFilter === "user"\) groups\.set\("user", \[\]\)/);
  assert.match(source, /sourceFilter === "all" \|\| sourceFilter === "bundled"\) groups\.set\("bundled", \[\]\)/);
  assert.match(source, /const source = sourceGroupKey\(skill\.source\)/);  assert.match(source, /source === "bundled"\) return 0/);
  assert.match(source, /source === "user"\) return 1/);
  assert.match(source, /orderedGroups\.map/);
  assert.match(source, /user: "全局技能"/);
  assert.match(source, /source === "user" \? "还没有全局技能"/);
  assert.match(source, /\["user", "用户", userEnabled\]/);
  assert.match(source, /statusFilter !== "all" && invocationStatusKind\(skill\) !== statusFilter/);
  assert.match(source, /sourceFilter !== "all" && sourceGroupKey\(skill\.source\) !== sourceFilter/);
  assert.match(source, /renderFilterSection\("调用状态", STATUS_FILTERS/);
  assert.match(source, /renderFilterSection\("来源", SOURCE_FILTERS/);
  assert.match(source, /h\(FilterIcon\)/);
  assert.match(source, /toggleChannel\(\{ name: conflictName \}, "both", false\)/);
  assert.doesNotMatch(source, /"受限"/);
  assert.doesNotMatch(source, /filteredSkills\.length === 0/);
  assert.match(source, /transition:transform \.15s var\(--ds-ease-in-out\)/);
  assert.match(source, /\.skp-group-toggle\[aria-expanded=true\] \.skp-group-caret\{transform:rotate\(90deg\)\}/);
  assert.match(source, /\.skp-refresh-button\{[^}]*height:32px/);
  assert.match(source, /h\(WorkspaceTriangleIcon\)/);
  assert.match(source, /h\(Input, \{/);
  assert.doesNotMatch(source, /PluginArtworkDefault|skp-card-icon/);
  assert.match(source, /h\(Tag, \{/);
  assert.match(source, /h\(Switch, \{/);
  assert.match(source, /onChange: \(next\) => props\.onToggleChannel\(skill, channel, next\)/);
  assert.match(source, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
});

test("refresh reuses the native Button with the current 32px header sizing", async () => {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf('h(Button, {');
  const end = source.indexOf('h("div", { className: "skp-fill-body" },', start);
  assert.ok(start >= 0 && end > start);
  const refresh = source.slice(start, end);
  assert.match(refresh, /variant: "outline"/);
  assert.match(refresh, /size: "sm"/);
  assert.match(refresh, /h\(StateDot, \{ state: "ongoing", size: 13 \}\)/);
  assert.match(refresh, /h\(IconRefreshOutlineRegular, \{ size: 13 \}\)/);
  assert.match(refresh, /h\("span", null, "刷新"\)/);
  assert.doesNotMatch(source, /function RefreshIcon\(/);
});

test("missing rows replace invocation switches with the native policy delete button", async () => {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const row = source.slice(source.indexOf("function SkillRow"), source.indexOf("function SkillPolicyPanel"));
  assert.match(row, /missing \? h\(Button, \{/);
  assert.match(row, /variant: "outline"/);
  assert.match(row, /size: "sm"/);
  assert.match(row, /icon: h\(IconTrashOutlineRegular, \{ size: 13 \}\)/);
  assert.match(row, /onClick: \(\) => props\.onRemovePolicy\(skill\)/);
  assert.doesNotMatch(row, /仅删除未加载策略，不删除 Skill 源文件|Provider：|文件状态：/);
  assert.match(row, /skill\.manageable === true \? h\("div", \{ className: "skp-switch-fields"/);
  assert.match(source, /body: JSON\.stringify\(\{ name, action: "remove" \}\)/);
  assert.match(source, /onRemovePolicy: removePolicy/);
  const start = source.indexOf("function invocationStatusKind");
  const end = source.indexOf("function SkillPolicyPanel", start);
  const SkillRow = runInNewContext(`${source.slice(start, end)}\nSkillRow;`, {
    text: (value, fallback) => value ?? fallback,
    h: (type, props, ...children) => ({ type, props, children }),
    Button: "Button",
    Switch: "Switch",
    Tag: "Tag",
    IconTrashOutlineRegular: "IconTrashOutlineRegular"
  });
  const missingTree = JSON.stringify(SkillRow({ skill: { name: "ghost", missing: true } }));
  assert.match(missingTree, /Button/);
  assert.match(missingTree, /删除/);
  assert.doesNotMatch(missingTree, /Switch/);
  const loadedTree = JSON.stringify(SkillRow({ skill: { name: "loaded", missing: false, manageable: true } }));
  assert.match(loadedTree, /Switch/);
  assert.match(loadedTree, /"title":"loaded"/);
  assert.match(loadedTree, /"title":"无说明"/);
  assert.doesNotMatch(loadedTree, /Button|用户手动调用（\/名称）/);
  const runtimeTree = JSON.stringify(SkillRow({ skill: { name: "runtime", missing: false, manageable: false } }));
  assert.match(runtimeTree, /仅显示/);
  assert.doesNotMatch(runtimeTree, /Switch|Button/);
});

test("invocation channels map to independent filter kinds and badge tones", async () => {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf("function invocationStatusKind");
  const end = source.indexOf("function SkillRow", start);
  assert.ok(start >= 0 && end > start);
  const helpers = runInNewContext(`${source.slice(start, end)}\n({ kind: invocationStatusKind, status: invocationStatus });`, {});
  assert.equal(helpers.kind({}), "available");
  assert.equal(helpers.kind({ modelInvocable: true, userInvocable: false }), "model");
  assert.equal(helpers.kind({ modelInvocable: false, userInvocable: true }), "user");
  assert.equal(helpers.kind({ modelInvocable: false, userInvocable: false }), "disabled");
  assert.equal(helpers.kind({ missing: true }), "missing");
  assert.equal(helpers.status({}).label, "可调用");
  assert.equal(helpers.status({}).tone, "success");
  assert.equal(helpers.status({}).title, undefined);
  assert.equal(helpers.status({ modelInvocable: true, userInvocable: false }).label, "仅模型");
  assert.equal(helpers.status({ modelInvocable: true, userInvocable: false }).tone, "warning");
  assert.equal(helpers.status({ modelInvocable: false, userInvocable: true }).label, "仅用户");
  assert.equal(helpers.status({ modelInvocable: false, userInvocable: true }).tone, "warning");
  assert.equal(helpers.status({ modelInvocable: false, userInvocable: false }).label, "已禁用");
  assert.equal(helpers.status({ modelInvocable: false, userInvocable: false }).tone, "danger");
  assert.equal(helpers.status({ missing: true }).label, "已禁用");
  assert.equal(helpers.status({ missing: true }).tone, "danger");
});