import { parse } from "yaml";
import { isSkillName } from "./policy-store.js";

export const FILE_BACKED_SOURCES = new Set(["project-dsh", "project-agents", "custom", "user-dsh", "user-agents"]);

export function isLiveFileSource(source) {
  return FILE_BACKED_SOURCES.has(source);
}

function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") switch (value.toLowerCase()) {
    case "true":
    case "yes":
    case "on": return true;
    case "false":
    case "no":
    case "off": return false;
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}

function invocationFromDocument(data) {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) throw new TypeError(`unsupported frontmatter field "${legacy}"`);
  }
  const disableModelInvocation = frontmatterBoolean(data, "disable-model-invocation");
  const userInvocable = frontmatterBoolean(data, "user-invocable");
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false
  };
}

/** Parse the same frontmatter and invocation grammar as the DSH filesystem provider. */
export function parseSkillDocument(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (match?.[1] === undefined) throw new TypeError("missing YAML frontmatter");
  const data = parse(match[1]);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("invalid frontmatter");
  if (!isSkillName(data.name)) throw new TypeError("invalid skill name");
  if (typeof data.description !== "string" || data.description.length === 0) throw new TypeError("missing description");
  return {
    data,
    content: raw.slice(match[0].length).trim(),
    invocation: invocationFromDocument(data)
  };
}
