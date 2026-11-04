import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PolicyStore, isSkillName } from "./policy-store.js";
import { createPolicyProvider } from "./policy-provider.js";
import { mergeInventory, scanOfficialRoots } from "./inventory.js";
import { createLiveSkillLoader } from "./live-file.js";
import { isLiveFileSource } from "./skill-document.js";

const name = "skills-management";
const inject = ["webServer", "skills", "sessions", "agents", "workingDirectory"];
const API = "/api/dsh-skills-management";

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function loopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

function allowed(req, mutation = false) {
  const address = req.socket.remoteAddress ?? "";
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  if (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!loopbackHostname(host.hostname)) return false;
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return false;
  } catch {
    return false;
  }
  if (!mutation) return true;
  return req.headers["x-dsh-skills-management"] === "1"
    && String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function readJson(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { status: 400 });
  }
}

export function customSkillDirsFromLoader(entries) {
  const directories = [];
  for (const entry of entries ?? []) {
    if (entry.options?.name !== "@deepseek-ai/dsh-skill-filesystem") continue;
    const config = entry.options.config ?? entry.fiber?.config ?? {};
    if (Array.isArray(config.customSkillDirs)) {
      for (const path of config.customSkillDirs) if (typeof path === "string" && path.trim()) directories.push(path);
    }
  }
  return directories;
}

function sameInvocation(left, right) {
  return left.modelInvocable === right.modelInvocable && left.userInvocable === right.userInvocable;
}

function invocationOf(definition) {
  return {
    modelInvocable: definition.invocation?.modelInvocable !== false,
    userInvocable: definition.invocation?.userInvocable !== false
  };
}

function sameResourceBase(left, right) {
  const a = left ?? null;
  const b = right ?? null;
  if (a === b) return true;
  if (a === null || b === null || a.kind !== b.kind) return false;
  if (a.kind === "directory") return a.path === b.path;
  if (a.kind === "url") return a.url === b.url;
  if (a.kind === "opaque") return a.description === b.description;
  return false;
}

async function completeRegistrySkills(registry, options) {
  // DSH 0.2.2 reports partial provider discovery through snapshot().complete.
  // Keep list() as the compatibility path for older supported DSH versions.
  if (typeof registry.snapshot !== "function") return registry.list(options);
  const snapshot = await registry.snapshot(options);
  if (!snapshot || !Array.isArray(snapshot.skills) || snapshot.complete !== true) {
    throw new Error("DSH SkillRegistry discovery is incomplete for this view");
  }
  return snapshot.skills;
}

function apply(ctx, config = {}) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh"));
  const agentsHome = resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents"));
  const policyFile = resolve(config.policyFile ?? join(dshHome, "skills-management", "disabled.json"));
  const store = new PolicyStore(policyFile);
  const getCustomSkillDirs = () => {
    const own = Array.isArray(config.customSkillDirs) ? config.customSkillDirs : [];
    let loaderDirs = [];
    try { loaderDirs = customSkillDirsFromLoader(ctx.get("loader", false)?.entries()); } catch {}
    return [...new Set([...own, ...loaderDirs].map((path) => resolve(path)))];
  };
  const loadLive = createLiveSkillLoader({ dshHome, agentsHome, getCustomSkillDirs });
  const invalidators = new Set();
  const agentProviders = new Map();
  let mutationQueue = Promise.resolve();
  const serializeMutation = (operation) => {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  };

  const register = (target) => {
    const skills = target.get?.("skills", false) ?? target.skills;
    if (!skills?.registerProvider) return undefined;
    let invalidate;
    let dispose;
    try {
      dispose = skills.registerProvider((control) => {
        invalidate = control.invalidate;
        invalidators.add(invalidate);
        return createPolicyProvider(store, target.logger ?? console, loadLive);
      });
    } catch (error) {
      if (invalidate) invalidators.delete(invalidate);
      throw error;
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (invalidate) invalidators.delete(invalidate);
      dispose();
    };
  };

  const globalProvider = register(ctx);
  if (globalProvider) ctx.effect(() => globalProvider, "skills-management: global provider");

  const detachAgent = (id, record, disposeEffect = false) => {
    if (agentProviders.get(id) !== record) return;
    agentProviders.delete(id);
    record.cleanup();
    if (disposeEffect && typeof record.effectDisposer === "function") record.effectDisposer();
  };
  const attachAgent = (agent) => {
    if (!agent?.ctx || agentProviders.has(agent.id)) return;
    let record;
    try {
      const cleanup = register(agent.ctx);
      if (!cleanup) return;
      record = { cleanup, effectDisposer: undefined };
      agentProviders.set(agent.id, record);
      record.effectDisposer = agent.ctx.effect(
        () => () => detachAgent(agent.id, record),
        `skills-management: agent provider ${agent.id}`
      );
    } catch (error) {
      if (record) detachAgent(agent.id, record, true);
      ctx.logger.warn(`[skills-management] cannot attach agent ${agent.id}: ${String(error)}`);
    }
  };
  for (const agent of ctx.agents.list()) attachAgent(agent);
  ctx.on("agent/created", ({ agent }) => attachAgent(agent));
  ctx.effect(() => () => {
    for (const [id, record] of [...agentProviders]) detachAgent(id, record, true);
  }, "skills-management: agent providers");

  const notify = () => {
    for (const invalidate of [...invalidators]) {
      try { invalidate(); } catch (error) { ctx.logger.warn(`[skills-management] invalidate failed: ${String(error)}`); }
    }
    try { ctx.emit("commands/change"); } catch {}
    for (const session of ctx.sessions.list()) {
      const id = session.id ?? session.header?.id;
      const agentPreset = session.header?.agentPreset ?? session.agentPreset;
      if (id === undefined || typeof agentPreset !== "string") continue;
      try { ctx.emit("agent-preset/selected", id, agentPreset); } catch {}
    }
  };

  const sessionSummaries = () => ctx.sessions.list().flatMap((session) => {
    const id = session.id ?? session.header?.id;
    if (id === undefined) return [];
    const cwd = session.header?.cwd ?? session.cwd;
    return [{
      id: String(id),
      cwd: typeof cwd === "string" ? cwd : "",
      agentPreset: session.header?.agentPreset ?? session.agentPreset
    }];
  });

  const resolveView = async (sessionId, signal) => {
    const sessions = sessionSummaries();
    const selected = sessionId === undefined ? undefined : sessions.find((session) => session.id === sessionId);
    if (sessionId !== undefined && !selected) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 });
    const live = sessionId === undefined ? undefined : ctx.agents.get(sessionId);
    const cwd = live !== undefined
      ? await ctx.workingDirectory.ensure(live, signal)
      : selected?.cwd || ctx.workingDirectory.defaultDirectory || process.cwd();
    const presets = ctx.get("agentPresets", false);
    const registry = (live === undefined ? undefined : presets?.serviceFor(live, "skills"))
      ?? ctx.get("skills", false);
    if (!registry?.list) throw new Error("DSH SkillRegistry is unavailable");
    let lease;
    try {
      if (live === undefined && selected?.agentPreset && presets?.acquireScope) {
        lease = await presets.acquireScope(selected.agentPreset);
      }
      return {
        cwd,
        registry,
        scope: live ?? lease?.key,
        release: async () => {
          if (typeof lease?.[Symbol.asyncDispose] === "function") await lease[Symbol.asyncDispose]();
          else if (typeof lease?.dispose === "function") await lease.dispose();
        }
      };
    } catch (error) {
      if (typeof lease?.[Symbol.asyncDispose] === "function") await lease[Symbol.asyncDispose]();
      else if (typeof lease?.dispose === "function") await lease.dispose();
      throw error;
    }
  };

  // One global management inventory: aggregate every DSH composition, then
  // deduplicate by skill name. No session choice is exposed to the user or API.
  const inventory = async (signal) => {
    const customSkillDirs = getCustomSkillDirs();
    const sharedFileSkills = await scanOfficialRoots({
      cwd: process.cwd(), dshHome, agentsHome, customSkillDirs, areas: "shared"
    });
    const collectView = async (sessionId) => {
      const view = await resolveView(sessionId, signal);
      try {
        const [registrySkills, projectFileSkills] = await Promise.all([
          completeRegistrySkills(view.registry, { cwd: view.cwd, scope: view.scope, signal }),
          scanOfficialRoots({ cwd: view.cwd, dshHome, agentsHome, customSkillDirs, areas: "project" })
        ]);
        return { registrySkills, fileSkills: [...sharedFileSkills, ...projectFileSkills] };
      } finally {
        await view.release();
      }
    };
    const sessionIds = sessionSummaries().map((session) => session.id);
    const [policy, ...views] = await Promise.all([
      store.read(),
      collectView(undefined),
      ...sessionIds.map((sessionId) => collectView(sessionId))
    ]);
    const mergedSkills = mergeInventory({
      views,
      policyEntries: policy.skills
    });
    const missingChanged = store.replaceMissing(mergedSkills.filter((skill) => skill.missing).map((skill) => skill.name));
    if (missingChanged) notify();
    return { policyFile, skills: mergedSkills };
  };

  // A global single-channel policy needs one unambiguous body. Collect all
  // same-name definitions so conflicting scopes can be rejected safely.
  const loadOriginal = async (name, signal) => {
    const definitions = [];
    for (const sessionId of [undefined, ...sessionSummaries().map((session) => session.id)]) {
      let view;
      try {
        view = await resolveView(sessionId, signal);
        const options = { cwd: view.cwd, scope: view.scope, signal };
        if (typeof view.registry.snapshot === "function") {
          const summaries = await completeRegistrySkills(view.registry, options);
          if (!summaries.some((skill) => skill.name === name)) continue;
        }
        const definition = await view.registry.get(name, options);
        if (definition !== undefined) definitions.push(definition);
      } finally {
        await view?.release();
      }
    }
    return definitions;
  };

  const routes = [
    {
      kind: "exact",
      path: `${API}/list`,
      handler: async (req, res) => {
        if (req.method !== "GET" || !allowed(req)) return json(res, 403, { error: "forbidden" });
        try {
          const result = await inventory();
          json(res, 200, {
            ...result,
            skills: result.skills.map(({ path: _path, resourceBase: _resourceBase, ...skill }) => skill)
          });
        } catch (error) {
          json(res, error.status ?? 500, { error: String(error?.message ?? error) });
        }
      }
    },
    {
      kind: "exact",
      path: `${API}/set`,
      handler: async (req, res) => {
        if (req.method !== "POST" || !allowed(req, true)) return json(res, 403, { error: "forbidden" });
        try {
          const body = await readJson(req);
          if (typeof body !== "object" || body === null || Array.isArray(body)) {
            return json(res, 400, { error: "expected a JSON object" });
          }
          if (body.action !== undefined && body.action !== "remove") {
            return json(res, 400, { error: "unsupported action" });
          }
          if (body.action === "remove") {
            if (!isSkillName(body.name)) return json(res, 400, { error: "expected a valid skill name" });
            await serializeMutation(async () => {
              const current = await inventory();
              const row = current.skills.find((skill) => skill.name === body.name && skill.missing);
              if (!row) {
                return json(res, 409, {
                  code: "original-present",
                  error: "该 Skill 已恢复加载或没有未加载策略，请刷新后使用调用开关；未删除策略。"
                });
              }
              await store.remove(body.name);
              store.setMissing(body.name, false);
              notify();
              json(res, 200, { ok: true, name: body.name, removed: true });
            });
            return;
          }
          if (!isSkillName(body.name) || (body.channel !== "model" && body.channel !== "user" && body.channel !== "both") || typeof body.enabled !== "boolean") {
            return json(res, 400, { error: "expected {name, channel: model|user|both, enabled} with a valid skill name" });
          }
          await serializeMutation(async () => {
            let exposedEntry;
            try {
              const policy = await store.read();
              const entry = policy.skills[body.name];
              let display = entry?.display;
              let sourcePath = entry?.sourcePath;
              let sourceBase = entry?.sourceBase;
              let originalInvocation = entry?.originalInvocation;
              if (entry === undefined) {
                const currentInventory = await inventory();
                display = currentInventory.skills.find((skill) => skill.name === body.name && !skill.missing);
                if (!display) return json(res, 404, { error: `skill is not currently loaded: ${body.name}` });
                if (!display.manageable || typeof display.path !== "string") {
                  return json(res, 409, { code: "non-file-provider", error: "仅文件型 Skill 支持调用策略管理；该条目仅供展示。" });
                }
                sourcePath = display.path;
                sourceBase = display.resourceBase ?? { kind: "directory", path: dirname(display.path) };
                originalInvocation = {
                  modelInvocable: display.modelInvocable,
                  userInvocable: display.userInvocable
                };
              }
              originalInvocation ??= { modelInvocable: true, userInvocable: true };
              const current = entry ?? originalInvocation;
              const next = body.channel === "both"
                ? { modelInvocable: body.enabled, userInvocable: body.enabled }
                : {
                    modelInvocable: body.channel === "model" ? body.enabled : current.modelInvocable,
                    userInvocable: body.channel === "user" ? body.enabled : current.userInvocable
                  };
              if (entry === undefined && sameInvocation(next, current)) {
                return json(res, 200, { ok: true, name: body.name, invocation: next });
              }
              if (sameInvocation(next, originalInvocation)) {
                await store.remove(body.name);
                store.setMissing(body.name, false);
                notify();
                return json(res, 200, { ok: true, name: body.name, invocation: next });
              }
              const needsBody = next.modelInvocable || next.userInvocable;
              if (needsBody) {
                // Every enabled file policy needs a current, unambiguous source.
                // Any failure, including the final write, restores the old policy.
                if (entry !== undefined) {
                  exposedEntry = entry;
                  await store.remove(body.name);
                  notify();
                }
                const originals = await loadOriginal(body.name);
                const original = originals[0];
                const partial = next.modelInvocable !== next.userInvocable;
                const originalFlags = original === undefined ? undefined : invocationOf(original);
                const conflicting = original !== undefined && originals.slice(1).some((definition) =>
                  definition.content !== original.content
                  || !sameResourceBase(definition.resourceBase, original.resourceBase)
                  || (partial && !sameInvocation(invocationOf(definition), originalFlags))
                );
                const nonFile = original !== undefined && (!isLiveFileSource(original.source ?? display?.source)
                  || typeof original.path !== "string");
                if (!conflicting && original !== undefined && !nonFile) {
                  display = display ?? {
                    description: original.description,
                    provider: original.provider,
                    source: original.source
                  };
                  sourcePath = original.path;
                  sourceBase = original.resourceBase ?? { kind: "directory", path: dirname(original.path) };
                }
                if (conflicting || original === undefined || nonFile) {
                  if (exposedEntry !== undefined) {
                    await store.update(body.name, exposedEntry);
                    exposedEntry = undefined;
                    notify();
                  }
                  return json(res, 409, {
                    ...conflicting ? { code: "conflicting-original" } : nonFile ? { code: "non-file-provider" } : {},
                    error: conflicting
                      ? "同名 Skill 在不同作用域中的定义不一致。可显式同时关闭两个通道，或先统一同名 Skill。"
                      : nonFile
                        ? "仅文件型 Skill 支持调用策略管理；该条目仅供展示。"
                        : "原 Skill 已无法加载正文；请先启用两个通道再单独关闭一个。"
                  });
                }
              }
              let verified;
              try {
                verified = await loadLive({
                  name: body.name,
                  entry: { liveFile: true, display, sourcePath, sourceBase },
                  cwd: process.cwd()
                });
              } catch (error) {
                if (exposedEntry !== undefined) {
                  await store.update(body.name, exposedEntry);
                  exposedEntry = undefined;
                  notify();
                }
                ctx.logger.warn(`[skills-management] cannot verify file source ${body.name}: ${String(error)}`);
                return json(res, 409, {
                  code: "invalid-file-source",
                  error: "当前 Skill 源文件不存在、内容无效或名称不匹配，未保存策略。"
                });
              }
              if (!verified) {
                if (exposedEntry !== undefined) {
                  await store.update(body.name, exposedEntry);
                  exposedEntry = undefined;
                  notify();
                }
                return json(res, 409, { code: "invalid-file-source", error: "当前 Skill 不是可验证的文件型条目，未保存策略。" });
              }
              sourcePath = verified.path;
              sourceBase = verified.resourceBase;
              const updated = await store.update(body.name, {
                ...next,
                originalInvocation,
                ...display === undefined ? {} : { display },
                ...sourcePath === undefined ? {} : { sourcePath },
                ...sourceBase === undefined ? {} : { sourceBase },
                liveFile: true
              });
              exposedEntry = undefined;
              store.setMissing(body.name, false);
              notify();
              const saved = updated.skills[body.name];
              json(res, 200, {
                ok: true,
                name: body.name,
                invocation: saved === undefined
                  ? next
                  : { modelInvocable: saved.modelInvocable, userInvocable: saved.userInvocable }
              });
            } catch (error) {
              if (exposedEntry !== undefined) {
                try {
                  await store.update(body.name, exposedEntry);
                  notify();
                } catch (restoreError) {
                  ctx.logger.warn(`[skills-management] cannot restore previous policy ${body.name}: ${String(restoreError)}`);
                }
              }
              throw error;
            }
          });
        } catch (error) {
          json(res, error.status ?? 500, { error: String(error?.message ?? error) });
        }
      }
    }
  ];

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, "skills-management: routes");
}

export { apply, inject, name };
