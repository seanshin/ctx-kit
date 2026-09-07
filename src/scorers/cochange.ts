/**
 * Git co-change ranking (plan §4.7, stream E — a kill-criterion experiment,
 * not an assumed feature).
 *
 * Co-change is only ever meaningful *relative to a seed set* (a module's own
 * files, a `--diff` seed list, or a query's top hits) — "changes often" is
 * not "is important" on its own. It must never be wired into the unscoped
 * repository map; `core/pack.ts`'s `target-files` section is the only place
 * that calls `coChangeSeeds`/`makeCoChangeScorer`, and `buildRepoMap` never
 * does.
 *
 * Memory: the plan explicitly forbids an N×N co-change matrix — unusable
 * past a few thousand files. Because co-change is always seed-relative, only
 * the seed *columns* are ever accumulated (`seedColumnSums` below), which is
 * O(files touched alongside a seed) rather than O(files²).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import picomatch from "picomatch";
import { BUILTIN_IGNORE_DIRS, GENERATED_DIR, type CtxConfig } from "../core/config.js";
import { isRepo, logCommits } from "../core/git.js";
import { rankFiles, type Scorer } from "../core/repomap.js";
import type { Selection } from "../core/select.js";
import { makeQueryScorer } from "./query.js";

/** Bulk refactors touch nearly everything and swamp the counts (plan §4.7). */
const MAX_COMMIT_FILES = 50;
/** Below this much history the signal is too thin to trust (plan §6-C). */
const MIN_HISTORY_COMMITS = 50;
/** "γ 초기 1" (plan §4.7) — start at 1, tune only once adopted. */
const GAMMA = 1;
/** How many of a query's own top hits become co-change seeds for `--about`. */
const TOP_QUERY_SEEDS = 10;

function git(root: string, args: string[]): { ok: boolean; stdout: string } {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ok: res.status === 0, stdout: res.stdout ?? "" };
}

function headCommit(root: string): string | null {
  const res = git(root, ["rev-parse", "HEAD"]);
  return res.ok ? res.stdout.trim() : null;
}

function isShallow(root: string): boolean {
  return git(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
}

function historyDepth(root: string): number {
  const res = git(root, ["rev-list", "--count", "HEAD"]);
  return res.ok ? Number.parseInt(res.stdout.trim(), 10) || 0 : 0;
}

/**
 * Degradation per plan §6-C: not a repository, a shallow clone, or fewer
 * than 50 commits of history all silently disable co-change — never an
 * error. Unlike `--diff`, co-change is an optional ranking signal, not the
 * point of the command, so there is nothing useful an error would protect.
 */
export function coChangeAvailable(root: string): boolean {
  try {
    if (!isRepo(root)) return false;
    if (isShallow(root)) return false;
    return historyDepth(root) >= MIN_HISTORY_COMMITS;
  } catch {
    return false;
  }
}

interface CacheEntry {
  head: string;
  commits: number;
  files: string[][];
}

/** Process-lifetime cache: repeat scorer builds in one run (e.g. `--explain`) skip both disk and git. */
let memCache: CacheEntry | null = null;

function cachePath(root: string): string {
  return join(root, GENERATED_DIR, "cochange-cache.json");
}

function readDiskCache(root: string): CacheEntry | null {
  try {
    if (!existsSync(cachePath(root))) return null;
    const parsed = JSON.parse(readFileSync(cachePath(root), "utf8"));
    if (parsed && typeof parsed.head === "string" && Array.isArray(parsed.files)) {
      return parsed as CacheEntry;
    }
  } catch {
    // missing, unreadable, or corrupt — fall through to a fresh scan.
  }
  return null;
}

function writeDiskCache(root: string, entry: CacheEntry): void {
  try {
    mkdirSync(join(root, GENERATED_DIR), { recursive: true });
    writeFileSync(cachePath(root), JSON.stringify(entry), "utf8");
  } catch {
    // best-effort cache — a write failure must not break ranking.
  }
}

/**
 * Bulk-filtered commit file-lists, cached under `docs/generated/` keyed by
 * HEAD + the configured commit window (plan §6-B: one scan, cached, and
 * invalidated when HEAD moves). This caches the parsed git history, not a
 * co-change matrix — seed-relative counting still happens fresh per scorer.
 */
function filteredCommits(root: string, limit: number): string[][] {
  const head = headCommit(root);
  if (head) {
    if (memCache && memCache.head === head && memCache.commits === limit) return memCache.files;
    const disk = readDiskCache(root);
    if (disk && disk.head === head && disk.commits === limit) {
      memCache = disk;
      return disk.files;
    }
  }
  const raw = logCommits(root, limit);
  const files = raw.filter((commitFiles) => commitFiles.length <= MAX_COMMIT_FILES);
  if (head) {
    const entry: CacheEntry = { head, commits: limit, files };
    memCache = entry;
    writeDiskCache(root, entry);
  }
  return files;
}

/**
 * Σ_{s∈S} co[F][s] for every file F touched alongside a seed, accumulated
 * directly — never as a full co[F][s'] matrix over all files s' (plan
 * §4.7's memory rule). `commits` must already be bulk-filtered.
 */
function seedColumnSums(seeds: string[], commits: string[][]): Map<string, number> {
  const seedSet = new Set(seeds);
  const sums = new Map<string, number>();
  for (const commitFiles of commits) {
    const commitSeeds = commitFiles.filter((f) => seedSet.has(f));
    if (commitSeeds.length === 0) continue;
    for (const s of commitSeeds) {
      for (const f of commitFiles) {
        if (f === s) continue;
        sums.set(f, (sums.get(f) ?? 0) + 1);
      }
    }
  }
  return sums;
}

/**
 * Build a `Scorer` (core/repomap.ts's seam) for one seed set. Contribution
 * is `Σ_{s∈S} co[F][s] / |S|`, max-normalized to 0..1, times γ=1 (plan
 * §4.7). Empty when co-change is unavailable (§6-C) or the seed set is
 * empty. The caller (`core/pack.ts`) is expected to only reach this when a
 * real seed set exists and `config.ranking.cochange` is on; the checks here
 * are a second, defensive line so this function is never unsafe to call.
 */
export function makeCoChangeScorer(seeds: string[]): Scorer {
  return (_files, config) => {
    const out = new Map<string, number>();
    if (seeds.length === 0) return out;
    if (!coChangeAvailable(config.root)) return out;
    const commits = filteredCommits(config.root, config.ranking.commits);
    const sums = seedColumnSums(seeds, commits);
    if (sums.size === 0) return out;
    const raw = new Map<string, number>();
    for (const [f, sum] of sums) raw.set(f, sum / seeds.length);
    const max = Math.max(0, ...raw.values());
    if (max <= 0) return out;
    for (const [f, v] of raw) out.set(f, (v / max) * GAMMA);
    return out;
  };
}

/**
 * Git history has no notion of "ignored" — bot-maintained bookkeeping files
 * (a `.bkit/` agent-state file, a `docs/.pdca-status.json` progress log)
 * that get rewritten on nearly every commit will otherwise swamp a genuine
 * co-change signal with noise no reference-based list would ever surface
 * either, since `rankFiles`/`walkFiles` already skip dot-segments and
 * `BUILTIN_IGNORE_DIRS` (found on a real repository — see verification).
 * Keeps the co-change reach list inside the same universe of "real" files
 * the rest of the map already draws from.
 */
function isIgnoredPath(rel: string): boolean {
  return rel.split("/").some((seg) => seg.startsWith(".") || BUILTIN_IGNORE_DIRS.has(seg));
}

/**
 * Files *outside* a module that co-change strongly with it — the case the
 * ordinary seed-relative scorer above can never surface, because a module
 * pack's candidate pool is the module's own files (a re-rank can only
 * reorder what is already in the pool). The canonical example is a database
 * model and the migration that creates its table: they share no text, so
 * static reference ranking can never connect them, but they change together
 * in git history. Paths + raw co-change sum, ranked strongest first, capped
 * to `limit`. `own` (the module's own files) is excluded — those already
 * have their own section — and so is anything matching `config.exclude`,
 * which is the user's explicit instruction and must never be overridden by
 * a ranking signal, and anything no longer present in the working tree
 * (nothing to read). Empty whenever co-change itself would be: no seeds, no
 * git history, too little of it, or no co-changing files found at all.
 */
export function coChangeOutsideModule(
  config: CtxConfig,
  own: ReadonlySet<string>,
  seeds: string[],
  limit: number,
): { rel: string; score: number }[] {
  if (seeds.length === 0) return [];
  if (!coChangeAvailable(config.root)) return [];
  const commits = filteredCommits(config.root, config.ranking.commits);
  const sums = seedColumnSums(seeds, commits);
  if (sums.size === 0) return [];
  const isExcluded = config.exclude.length > 0 ? picomatch(config.exclude, { dot: true }) : null;
  return [...sums.entries()]
    .filter(([f]) => !own.has(f))
    .filter(([f]) => !isExcluded?.(f))
    .filter(([f]) => !isIgnoredPath(f))
    .filter(([f]) => existsSync(join(config.root, f)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([rel, score]) => ({ rel, score }));
}

/**
 * Resolve the seed set co-change should be scored against, per plan §4.7: a
 * module's own files, a `--diff` seed list, or (for `--about`) the query's
 * own top hits. Returns `[]` when none of those apply — the caller must
 * treat that as "do not apply co-change" (it must never touch the unscoped
 * repository map, which has no module/diff/query and never calls this).
 */
export function coChangeSeeds(
  config: CtxConfig,
  opts: { module?: string; about?: string; diff?: string },
  selection: Selection,
): string[] {
  if (opts.diff !== undefined) return selection.seeds;
  if (opts.module) return selection.files;
  if (opts.about) {
    return rankFiles(config, { files: selection.files, scorers: [makeQueryScorer(opts.about)] })
      .slice(0, TOP_QUERY_SEEDS)
      .map((e) => e.rel);
  }
  return [];
}
