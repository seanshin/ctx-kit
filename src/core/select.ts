/**
 * Target selection — which files a pack is about.
 *
 * The seam that lets work streams add selection modes without editing each
 * other's code (docs/plan-v2.md §8-B.2). Each mode is a branch here that
 * delegates to its own module:
 *   module  → this file (shipped)
 *   about   → ../scorers/query.ts   (stream B, plan §4.4)
 *   diff    → ../select/diff.ts     (stream D, plan §4.5)
 */
import { extname } from "node:path";
import type { CtxConfig } from "./config.js";
import { walkFiles } from "./fs.js";
import { SOURCE_EXTENSIONS } from "../adapters/symbols.js";

export interface SelectOptions {
  /** Module name from context.config.yaml. */
  module?: string;
  /** Free-text task description; ranks files by relevance (plan §4.4). */
  about?: string;
  /** Git revision range or "--staged"; seeds the pack with changes (plan §4.5). */
  diff?: string;
}

export interface Selection {
  /** Candidate files, before ranking. */
  files: string[];
  /**
   * Files that must appear even if the budget is exceeded. A review pack
   * without the changed files is worthless, so `--diff` seeds go here.
   */
  seeds: string[];
  /** Label for the pack header and output filename. */
  label: string;
}

export function moduleFiles(config: CtxConfig, moduleName: string): string[] {
  const globs = config.modules[moduleName];
  if (!globs) {
    const known = Object.keys(config.modules).join(", ") || "(none defined)";
    throw new Error(`unknown module "${moduleName}" — defined modules: ${known}`);
  }
  return walkFiles(config.root, { include: globs, exclude: config.exclude });
}

export function allSourceFiles(config: CtxConfig): string[] {
  return walkFiles(config.root, { exclude: config.exclude }).filter((f) =>
    SOURCE_EXTENSIONS.has(extname(f)),
  );
}

export function select(config: CtxConfig, opts: SelectOptions = {}): Selection {
  if (opts.diff !== undefined) {
    throw new Error("pack --diff is planned for 0.4.0 (docs/plan-v2.md §4.5)");
  }
  const files = opts.module ? moduleFiles(config, opts.module) : allSourceFiles(config);
  return { files, seeds: [], label: opts.module ?? "all" };
}
