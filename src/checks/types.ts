/**
 * The check seam. Every gate item is a `Check` in its own file, registered
 * in `checks/index.ts`, so independent work streams add checks without
 * editing each other's code (docs/plan-v2.md §8-B.2).
 */
import type { CtxConfig } from "../core/config.js";
import type { RankedFile } from "../core/repomap.js";

export interface CheckResult {
  /**
   * "info" reads as informational: printed distinctly, never counted toward
   * the CLI's failure exit code (src/cli.ts's `check` action). It exists so
   * `HealthConfig`'s 4-valued `Level` (core/config.ts) can round-trip without
   * a lossy mapping into "warn" — see health.ts's `coverage` sub-check.
   */
  level: "ok" | "warn" | "fail" | "info";
  name: string;
  detail: string;
  /**
   * Structured location this result concerns, when the producing check can
   * name one. Optional: checks outside this stream's ownership (rules, sync,
   * repomap, secrets) don't set it. When present, `core/baseline.ts` keys the
   * ratchet on `{name, location, subject}` instead of parsing `detail`, so an
   * unrelated wording change in `detail` can't silently invalidate a baseline
   * entry (docs/plan-v2.md §4.2).
   */
  location?: { file: string; line?: number };
  /**
   * Stable identifier of the specific thing flagged — a constraint id, a
   * symbol name, a documented path/command — distinct from the prose in
   * `detail` for the same reason as `location`.
   */
  subject?: string;
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
