import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { POLICY_PROVIDER } from "./policy-provider.js";
import { isLiveFileSource, parseSkillDocument } from "./skill-document.js";

export const SOURCE_RANK = Object.freeze({
  "project-dsh": 100,
  "project-agents": 200,
  runtime: 250,
  custom: 300,
  "user-dsh": 400,
  "user-agents": 500,
  bundled: 600,
  missing: 1000
});

export function findProjectRoot(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

function isAbsentPath(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

/** Read only one direct level of an explicitly DSH-owned skill root. */
export async function scanSkillRoot(root, source) {
  const rank = SOURCE_RANK[source] ?? 999;
  const result = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isAbsentPath(error)) return result;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (source === "user-dsh" && entry.name === ".system") continue;
    let file;
    let linked = false;
    if (entry.isDirectory()) file = join(root, entry.name, "SKILL.md");
    else if (entry.isFile() && entry.name.endsWith(".md")) file = join(root, entry.name);
    else if (entry.isSymbolicLink()) {
      linked = true;
      try {
        const target = await stat(join(root, entry.name));
        if (target.isDirectory()) file = join(root, entry.name, "SKILL.md");
        else if (target.isFile() && entry.name.endsWith(".md")) file = join(root, entry.name);
        else continue;
      } catch (error) {
        if (isAbsentPath(error)) continue;
        throw error;
      }
    } else continue;
    let raw;
    let canonicalPath;
    try {
      [raw, canonicalPath] = await Promise.all([readFile(file, "utf8"), realpath(file)]);
    } catch (error) {
      if (isAbsentPath(error)) continue;
      throw error;
    }
    try {
      const { data, invocation } = parseSkillDocument(raw);
      result.push({
        name: data.name,
        description: data.description,
        ...typeof data.whenToUse === "string" ? { whenToUse: data.whenToUse } : {},
        provider: "filesystem",
        source,
        rank,
        invocation,
        path: file,
        realPath: canonicalPath,
        fileState: "file",
        linked
      });
    } catch {
      // Match the management goal: an invalid file is not a loadable DSH skill.
    }
  }
  return result;
}

export async function scanOfficialRoots({ cwd, dshHome, agentsHome, customSkillDirs = [], areas = "all" }) {
  const project = areas === "shared" ? undefined : findProjectRoot(cwd);
  const candidates = [
    ...areas === "shared" ? [] : [
      { path: join(project, ".dsh", "skills"), source: "project-dsh" },
      { path: join(project, ".agents", "skills"), source: "project-agents" }
    ],
    ...areas === "project" ? [] : [
      ...customSkillDirs.map((path) => ({ path, source: "custom" })),
      { path: join(dshHome, "skills"), source: "user-dsh" },
      { path: join(agentsHome, "skills"), source: "user-agents" }
    ]
  ];
  const roots = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const path = resolve(candidate.path);
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ ...candidate, path });
  }
  const groups = await Promise.all(roots.map(async ({ path, source }) => scanSkillRoot(path, source)));
  return groups.flat();
}

function publicEntry(skill, policyEntry) {
  const modelInvocable = policyEntry ? policyEntry.modelInvocable : skill.invocation?.modelInvocable !== false;
  const userInvocable = policyEntry ? policyEntry.userInvocable : skill.invocation?.userInvocable !== false;
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === void 0 ? {} : { whenToUse: skill.whenToUse },
    provider: skill.provider,
    source: skill.source,
    rank: skill.rank ?? 600,
    modelInvocable,
    userInvocable,
    disabled: !modelInvocable || !userInvocable,
    missing: skill.missing === true,
    linked: skill.linked === true,
    fileState: skill.fileState ?? "virtual",
    // Only DSH filesystem roots are controllable. Provider-owned bundled assets
    // remain read-only even when a SKILL.md exists inside a package or runtime.
    manageable: skill.registered === true && isLiveFileSource(skill.source)
      && (skill.fileState === "file" || skill.fileState === "provider-file"),
    // Internal only: routes strip source locations before responding.
    path: skill.path,
    resourceBase: skill.resourceBase
  };
}

function rankOf(skill) {
  return skill.rank ?? SOURCE_RANK[skill.source] ?? 600;
}

/** Merge only evidence from one cwd/scope view; never borrow another view's files. */
function mergeView({ fileSkills = [], registrySkills = [] }) {
  const filesByName = new Map();
  for (const skill of fileSkills) {
    if (!filesByName.has(skill.name)) filesByName.set(skill.name, []);
    filesByName.get(skill.name).push(skill);
  }
  const rows = [];
  const registryNames = new Set();
  for (const skill of registrySkills) {
    registryNames.add(skill.name);
    const candidates = (filesByName.get(skill.name) ?? [])
      .filter((file) => file.source === skill.source && file.path);
    const paths = new Set(candidates.map((file) => file.path));
    const evidence = paths.size === 1 ? candidates[0] : undefined;
    const useEvidence = evidence !== undefined && (skill.path === undefined
      || skill.path === evidence.path
      || skill.path === evidence.realPath);
    // Fresh matching file evidence is authoritative for type and link state;
    // stale Registry metadata must not turn a new Junction back into a file.
    rows.push({
      ...skill,
      rank: rankOf(skill),
      registered: true,
      path: useEvidence ? evidence.path : skill.path,
      fileState: useEvidence
        ? evidence.fileState ?? skill.fileState
        : skill.fileState ?? (skill.path ? "provider-file" : "virtual"),
      linked: useEvidence ? evidence.linked ?? skill.linked : skill.linked
    });
  }
  // A Registry list is already arbitrated. File evidence cannot replace its
  // winner; it only supplies file-only rows or metadata for the same source.
  for (const skill of fileSkills) {
    if (!registryNames.has(skill.name)) rows.push({ ...skill, rank: rankOf(skill) });
  }
  return rows;
}

function missingFileOverlay(skill, row, policyEntry, loadedNames) {
  if (loadedNames.has(skill.name)) return false;
  if (policyEntry === undefined || skill.provider !== POLICY_PROVIDER || row.fileState !== "virtual") return false;
  // Only file-backed sources provide positive evidence of absence. An arbitrated
  // Registry cannot prove that a hidden runtime provider has disappeared.
  return isLiveFileSource(policyEntry.display?.source ?? row.source);
}

/** Merge per-view inventories, then apply the global name-based policy. */
export function mergeInventory({ fileSkills, registrySkills, views, policyEntries = {} }) {
  const merged = new Map();
  const loadedNames = new Set();
  for (const view of views ?? [{ fileSkills, registrySkills }]) {
    // Duplicate file candidates are ambiguous for metadata, but still prove
    // that an original definition exists and must not become a missing overlay.
    for (const skill of view.fileSkills ?? []) loadedNames.add(skill.name);
    for (const skill of mergeView(view)) {
      if (skill.provider !== POLICY_PROVIDER || skill.fileState !== "virtual") loadedNames.add(skill.name);
      const existing = merged.get(skill.name);
      if (existing !== undefined && existing.rank < skill.rank) continue;
      merged.set(skill.name, skill);
    }
  }
  const rows = [...merged.values()].map((skill) => {
    const candidatePolicy = policyEntries[skill.name];
    const policyEntry = candidatePolicy?.liveFile === true ? candidatePolicy : undefined;
    const row = publicEntry(skill, policyEntry);
    if (missingFileOverlay(skill, row, policyEntry, loadedNames)) return undefined;
    const display = policyEntry?.display;
    if (!row.disabled || display === undefined) return row;
    if (skill.provider === POLICY_PROVIDER && typeof skill.path === "string") {
      return {
        ...row,
        provider: display.provider ?? row.provider,
        source: display.source ?? row.source
      };
    }
    return {
      ...row,
      description: display.description ?? row.description,
      provider: display.provider ?? row.provider,
      source: display.source ?? row.source,
      whenToUse: display.whenToUse ?? row.whenToUse
    };
  }).filter((skill) => skill !== undefined);
  const present = new Set(rows.map((skill) => skill.name));
  for (const [name, policyEntry] of Object.entries(policyEntries)) {
    if (policyEntry.liveFile !== true || present.has(name)) continue;
    rows.push(publicEntry({
      name,
      description: policyEntry.display?.description ?? "当前未加载；可从本地策略移除限制。",
      provider: policyEntry.display?.provider ?? "dsh-skills-management",
      source: "missing",
      rank: SOURCE_RANK.missing,
      invocation: { modelInvocable: false, userInvocable: false },
      missing: true,
      fileState: "virtual"
    }, policyEntry));
  }
  return rows.sort((left, right) => (left.rank - right.rank) || left.name.localeCompare(right.name));
}
