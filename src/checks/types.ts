/**
 * The check seam. Every gate item is a `Check` in its own file, registered
 * in `checks/index.ts`, so independent work streams add checks without
 * editing each other's code (docs/plan-v2.md §8-B.2).
 */
import type { CtxConfig } from "../core/config.js";
import type { RankedFile } from "../core/repomap.js";

export interface CheckResult {
  level: "ok" | "warn" | "fail";
  name: string;
  detail: string;
}

export interface CheckOptions {
  maxRuleLines?: number;
  /** Execute commands documented in AGENTS.md (opt-in; see plan-v2 §10). */
  runCommands?: boolean;
  /** Ignore the recorded baseline and report every violation. */
  noBaseline?: boolean;
}

export interface CheckContext {
  config: CtxConfig;
  opts: CheckOptions;
  /**
   * File ranking, computed at most once per run and shared by every check —
   * ranking is the dominant cost, and `check` runs in a pre-commit hook
   * (docs/plan-v2.md §6-B).
   */
  ranked(): RankedFile[];
}

export interface Check {
  name: string;
  run(ctx: CheckContext): CheckResult[];
}
