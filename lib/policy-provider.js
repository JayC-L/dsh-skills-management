export const POLICY_PROVIDER = "dsh-skills-management";
export const POLICY_RANK = -1000000;

function invocationOf(entry) {
  return {
    modelInvocable: entry.modelInvocable,
    userInvocable: entry.userInvocable
  };
}

/**
 * Overlay verified file-backed skills only. Other providers stay untouched.
 * File metadata is refreshed on list(), and current content is read on get().
 * Missing or fully disabled entries never return the original body.
 */
export function createPolicyProvider(store, logger = console, loadLive = undefined) {
  return {
    name: POLICY_PROVIDER,
    async list(options = {}) {
      let policy;
      try {
        policy = await store.read();
      } catch (error) {
        // Invalid JSON must not disable everything, and is never overwritten.
        logger.warn?.(`[skills-management] cannot read policy; leaving skills unchanged: ${String(error)}`);
        return [];
      }
      const rows = [];
      for (const [name, entry] of Object.entries(policy.skills)) {
        if (entry.liveFile !== true) continue;
        const display = entry.display ?? {};
        let live;
        try {
          live = await loadLive?.({ name, entry, cwd: options.cwd, signal: options.signal });
          if (live) store.setMissing?.(name, false);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
          store.setMissing?.(name, true);
        }
        const missing = store.isMissing?.(name) === true;
        const whenToUse = live ? live.whenToUse : display.whenToUse;
        rows.push({
          name,
          description: live?.description || display.description || "Invocation is restricted by the local DSH skill policy.",
          ...whenToUse === void 0 ? {} : { whenToUse },
          provider: POLICY_PROVIDER,
          source: display.source ?? "runtime",
          rank: POLICY_RANK,
          ...live?.path === void 0 ? {} : { path: live.path },
          ...live?.resourceBase === void 0 ? {} : { resourceBase: live.resourceBase },
          invocation: missing ? { modelInvocable: false, userInvocable: false } : invocationOf(entry)
        });
      }
      return rows;
    },
    async get(candidate, options = {}) {
      const policy = await store.read();
      const entry = policy.skills[candidate.name];
      if (entry?.liveFile !== true) return void 0;
      const display = entry.display ?? {};
      const missing = store.isMissing?.(candidate.name) === true;
      const bothDisabled = missing || (!entry.modelInvocable && !entry.userInvocable);
      let live;
      if (!bothDisabled) {
        if (loadLive === undefined) throw new Error("live skill loader is unavailable");
        live = await loadLive({ name: candidate.name, entry, cwd: options.cwd, signal: options.signal });
        if (!live) throw new Error(`current source file not found for skill: ${candidate.name}`);
      }
      const placeholder = `Skill "${candidate.name}" has invocation restrictions in the local DSH skill policy.\n`;
      const whenToUse = live ? live.whenToUse : display.whenToUse;
      return {
        name: candidate.name,
        description: live?.description || display.description || "Invocation is restricted by the local DSH skill policy.",
        ...whenToUse === void 0 ? {} : { whenToUse },
        provider: POLICY_PROVIDER,
        source: display.source ?? candidate.source ?? "runtime",
        invocation: missing ? { modelInvocable: false, userInvocable: false } : invocationOf(entry),
        ...live?.path === void 0 ? {} : { path: live.path },
        ...live?.resourceBase === void 0 ? {} : { resourceBase: live.resourceBase },
        content: bothDisabled ? placeholder : live.content
      };
    }
  };
}
