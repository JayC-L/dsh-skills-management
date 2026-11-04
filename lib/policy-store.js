import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const POLICY_VERSION = 2;
export const MAX_POLICY_SKILLS = 512;
const DISPLAY_FIELDS = ["description", "provider", "source", "whenToUse"];

export function isSkillName(value) {
  return typeof value === "string" && SKILL_NAME.test(value);
}

function normalizeDisplay(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid skill display metadata");
  const result = {};
  for (const key of DISPLAY_FIELDS) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new TypeError(`invalid skill display ${key}`);
    if (key === "description" && value[key]?.length === 0) throw new TypeError("invalid skill display description");
    if (value[key] !== undefined) result[key] = value[key];
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function normalizeResourceBase(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid skill resource base");
  if (value.kind === "directory" && typeof value.path === "string") return { kind: "directory", path: value.path };
  throw new TypeError("file skill resource base must be a directory");
}

function normalizeEntry(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid skill policy entry");
  if (typeof value.modelInvocable !== "boolean" || typeof value.userInvocable !== "boolean") {
    throw new TypeError("skill policy entry requires both invocation booleans");
  }
  let originalInvocation;
  if (value.originalInvocation !== undefined) {
    const original = value.originalInvocation;
    if (typeof original !== "object" || original === null || Array.isArray(original)
      || typeof original.modelInvocable !== "boolean" || typeof original.userInvocable !== "boolean") {
      throw new TypeError("invalid original skill invocation");
    }
    originalInvocation = {
      modelInvocable: original.modelInvocable,
      userInvocable: original.userInvocable
    };
  }
  const baseline = originalInvocation ?? { modelInvocable: true, userInvocable: true };
  if (value.modelInvocable === baseline.modelInvocable && value.userInvocable === baseline.userInvocable) return undefined;
  const result = {
    modelInvocable: value.modelInvocable,
    userInvocable: value.userInvocable
  };
  const display = normalizeDisplay(value.display);
  if (display !== undefined) result.display = display;
  if (value.sourcePath !== undefined) {
    if (typeof value.sourcePath !== "string" || value.sourcePath.length === 0) throw new TypeError("invalid skill source path");
    result.sourcePath = value.sourcePath;
  }
  const sourceBase = normalizeResourceBase(value.sourceBase);
  if (sourceBase !== undefined) result.sourceBase = sourceBase;
  if (value.liveFile !== undefined && typeof value.liveFile !== "boolean") throw new TypeError("invalid live file marker");
  if (value.liveFile === true) result.liveFile = true;
  if (originalInvocation !== undefined) result.originalInvocation = originalInvocation;
  return result;
}

function normalizeDocument(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("skill policy must be a JSON object");
  }
  if (value.version !== POLICY_VERSION) {
    throw new TypeError(`unsupported skill policy version: ${String(value.version)}`);
  }
  if (typeof value.skills !== "object" || value.skills === null || Array.isArray(value.skills)) {
    throw new TypeError("skill policy skills must be an object");
  }
  const names = Object.keys(value.skills);
  if (names.length > MAX_POLICY_SKILLS || names.some((name) => !isSkillName(name))) {
    throw new TypeError("skill policy contains invalid or too many skill names");
  }
  const result = { version: POLICY_VERSION, skills: {} };
  for (const name of names.sort()) {
    const entry = normalizeEntry(value.skills[name]);
    if (entry?.liveFile === true) result.skills[name] = entry;
  }
  return result;
}

function emptyDocument() {
  return { version: POLICY_VERSION, skills: {} };
}

/** Atomic, serialized storage for the only file this plugin mutates. */
export class PolicyStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
    this.lastGood = undefined;
    this.missingNames = new Set();
  }

  isMissing(name) {
    return this.missingNames.has(name);
  }

  setMissing(name, missing) {
    if (missing) this.missingNames.add(name);
    else this.missingNames.delete(name);
  }

  replaceMissing(names) {
    const next = new Set(names);
    if (next.size === this.missingNames.size && [...next].every((name) => this.missingNames.has(name))) return false;
    this.missingNames = next;
    return true;
  }

  async read({ fallback = true } = {}) {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const value = normalizeDocument(JSON.parse(raw));
      this.lastGood = value;
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyDocument();
      // Providers may retain the last valid state. Writes disable this fallback
      // so an externally corrupted file is never replaced by stale memory.
      if (fallback && this.lastGood !== undefined) return this.lastGood;
      throw error;
    }
  }

  /** Set independent channels, or remove the entry when it matches originalInvocation (both enabled by default). */
  async update(name, entry) {
    if (!isSkillName(name)) throw new TypeError(`invalid skill name: ${String(name)}`);
    let normalized;
    if (entry !== null) {
      normalized = normalizeEntry(entry);
      if (normalized === undefined) entry = null;
    }
    const operation = this.queue.then(async () => {
      const current = await this.read({ fallback: false });
      const skills = { ...current.skills };
      if (entry === null) delete skills[name];
      else skills[name] = normalized;
      if (Object.keys(skills).length > MAX_POLICY_SKILLS) throw new RangeError("too many managed skills");
      const next = normalizeDocument({ version: POLICY_VERSION, skills });
      if (JSON.stringify(next) === JSON.stringify(current)) return next;
      await this.write(next);
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async remove(name) {
    return this.update(name, null);
  }

  async write(value) {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.disabled-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx");
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filePath);
      this.lastGood = value;
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
}