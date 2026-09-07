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
}

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
  };
}
