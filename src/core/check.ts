/**
 * `ctxkit check` — the CI gate. This file is only the driver: each check
 * lives in `src/checks/` and registers itself in `checks/index.ts`.
 *
 * fail = exit non-zero in CI; warn = informational.
 */
import { CHECKS } from "../checks/index.js";
import type { CheckContext, CheckOptions, CheckResult } from "../checks/types.js";
import type { CtxConfig } from "./config.js";
import { rankFiles, type RankedFile } from "./repomap.js";

export type { CheckOptions, CheckResult };

export function runChecks(config: CtxConfig, opts: CheckOptions = {}): CheckResult[] {
  // Ranking is the dominant cost and several checks want it, so it is
  // computed lazily and at most once per run (docs/plan-v2.md §6-B).
  let cached: RankedFile[] | null = null;
  const ctx: CheckContext = {
    config,
    opts,
    ranked: () => (cached ??= rankFiles(config)),
  };

  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    try {
      results.push(...check.run(ctx));
    } catch (err) {
      // One broken check must not hide the others.
      results.push({
        level: "fail",
        name: check.name,
        detail: `check crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}
