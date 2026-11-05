import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { scanOfficialRoots } from "./inventory.js";
import { parseSkillDocument } from "./skill-document.js";

async function existingResourceBase(resourceBase) {
  if (resourceBase?.kind !== "directory") return resourceBase;
  try {
    return (await stat(resourceBase.path)).isDirectory() ? resourceBase : undefined;
  } catch (error) {
    if (recoverableLookupError(error)) return undefined;
    throw error;
  }
}

async function readDefinition(path, name, signal, resourceBase = undefined) {
  const [raw, currentResourceBase] = await Promise.all([
    readFile(path, { encoding: "utf8", signal }),
    existingResourceBase(resourceBase)
  ]);
  const { data, content } = parseSkillDocument(raw);
  if (data.name !== name) {
    throw Object.assign(new Error(`skill identity mismatch in ${path}`), { code: "SKILL_IDENTITY_MISMATCH" });
  }
  return {
    path,
    description: data.description,
    ...typeof data.whenToUse === "string" ? { whenToUse: data.whenToUse } : {},
    resourceBase: currentResourceBase ?? { kind: "directory", path: dirname(path) },
    content
  };
}

function recoverableLookupError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "SKILL_IDENTITY_MISMATCH";
}

/** Resolve current file-backed metadata and bodies from the verified source. */
export function createLiveSkillLoader({ dshHome, agentsHome, getCustomSkillDirs }) {
  return async ({ name, entry, cwd, signal }) => {
    if (entry.liveFile !== true) return undefined;
    const source = entry.display?.source;
    const candidates = [];
    if (entry.sourcePath) candidates.push({ path: entry.sourcePath, resourceBase: entry.sourceBase });
    if (entry.sourceBase?.kind === "directory") {
      candidates.push({ path: join(entry.sourceBase.path, "SKILL.md"), resourceBase: entry.sourceBase });
    }
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
    for (const candidate of uniqueCandidates) {
      try {
        return await readDefinition(candidate.path, name, signal, candidate.resourceBase);
      } catch (error) {
        if (!recoverableLookupError(error)) throw error;
      }
    }
    const skills = await scanOfficialRoots({
      cwd: cwd || process.cwd(),
      dshHome,
      agentsHome,
      customSkillDirs: getCustomSkillDirs(),
      areas: "all"
    });
    const matches = skills.filter((skill) => skill.name === name && skill.source === source && skill.path);
    const paths = new Set(matches.map((skill) => skill.path));
    if (paths.size > 1) {
      throw Object.assign(new Error(`multiple current source files found for restricted skill "${name}"`), { code: "conflicting-original" });
    }
    if (paths.size === 0) {
      throw Object.assign(new Error(`current source file not found for restricted skill "${name}"`), { code: "ENOENT" });
    }
    return readDefinition(matches[0].path, name, signal);
  };
}
