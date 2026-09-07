import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

export const CONFIG_FILE = "context.config.yaml";
export const SCHEMA_VERSION = 1;
export const GENERATED_DIR = "docs/generated";

export interface ProfileConfig {
  /** Ordered sections to inject: agents | agents-summary | repomap | target-files */
  inject: string[];
  /** Approximate token budget for the assembled output. */
  budget: number;
}

/** Severity a check reports at. */
export type Level = "ok" | "warn" | "fail" | "info";

/**
 * A machine-checkable rule from AGENTS.md. Exactly one of the three shapes
 * is used per entry; see docs/plan-v2.md §4.2.
 */
export interface Constraint {
  id: string;
  /** symbol form: this symbol may only be defined in these paths. */
  symbol?: string;
  only_in?: string[];
  /** import form: files under `from` may not import anything under it. */
  from?: string[];
  must_not_import?: string[];
  /** pattern form: this regex may not appear under `in`. */
  forbid_pattern?: string;
  in?: string[];
}

/** Drift signals, each at a configurable severity. */
export interface HealthConfig {
  duplicates: Level;
  orphans: Level;
  coverage: Level;
  /** Globs never reported as orphans (generated code, plugins, …). */
  orphan_ignore: string[];
}

/** Knobs for how files are scored. */
export interface RankingConfig {
  /** Weight git co-change against the seed set (docs/plan-v2.md §4.7). */
  cochange: boolean;
  /** Commits scanned for co-change. */
  commits: number;
  /** Weight of the query score in `--about` (docs/plan-v2.md §4.4). */
  query_weight: number;
}

export interface CtxConfig {
  version: number;
  /** Absolute path of the target repository root. */
  root: string;
  /** Module name -> glob patterns (relative to root). */
  modules: Record<string, string[]>;
  profiles: Record<string, ProfileConfig>;
  /** Glob patterns excluded from all scans, in addition to built-in ignores. */
  exclude: string[];
  sync?: { targets?: string[] };
  /** Machine-checkable rules; empty means the constraint check is skipped. */
  constraints: Constraint[];
  health: HealthConfig;
  ranking: RankingConfig;
}

export const DEFAULT_HEALTH: HealthConfig = {
  duplicates: "warn",
  orphans: "warn",
  coverage: "info",
  orphan_ignore: [],
};

export const DEFAULT_RANKING: RankingConfig = {
  cochange: false,
  commits: 500,
  query_weight: 2,
};

/** Known violations recorded so only *new* ones fail (plan-v2 §4.2). */
export const BASELINE_FILE = `${GENERATED_DIR}/baseline.json`;

export const DEFAULT_PROFILES: Record<string, ProfileConfig> = {
  frontier: { inject: ["agents"], budget: 4000 },
  mid: { inject: ["agents", "repomap"], budget: 24000 },
  light: { inject: ["agents-summary", "repomap", "target-files"], budget: 12000 },
};

export const BUILTIN_IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".cache",
  "coverage",
]);

export function findConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(rootDir: string): CtxConfig {
  const root = resolve(rootDir);
  const path = join(root, CONFIG_FILE);
  let raw: Partial<CtxConfig> = {};
  if (existsSync(path)) {
    raw = (parse(readFileSync(path, "utf8")) ?? {}) as Partial<CtxConfig>;
    if (raw.version !== undefined && raw.version !== SCHEMA_VERSION) {
      throw new Error(
        `${CONFIG_FILE}: unsupported schema version ${raw.version} (expected ${SCHEMA_VERSION})`,
      );
    }
  }
  return {
    version: SCHEMA_VERSION,
    root,
    modules: raw.modules ?? {},
    profiles: { ...DEFAULT_PROFILES, ...(raw.profiles ?? {}) },
    exclude: raw.exclude ?? [],
    sync: raw.sync,
    constraints: raw.constraints ?? [],
    health: { ...DEFAULT_HEALTH, ...(raw.health ?? {}) },
    ranking: { ...DEFAULT_RANKING, ...(raw.ranking ?? {}) },
  };
}
