/**
 * Change-centered selection — `pack --diff <range>` (docs/plan-v2.md §4.5).
 *
 * Seeds are the changed *source* files, found via `core/git.ts#diffFiles`
 * (already `--diff-filter=d` + `--find-renames`, so deletions never appear
 * as unreadable seeds and a rename doesn't double-count as an add+delete).
 * Expansion adds the files that most reference the seeds' symbols — the
 * reviewer's "who calls this changed code" list — capped at the top 10 by
 * reference count.
 *
 * Wired in through `core/select.ts`'s `diff` branch; nothing outside that
 * seam should import this module directly (see docs/plan-v2.md §8-B.3).
 */
import { extname } from "node:path";
import type { CtxConfig } from "../core/config.js";
import { diffFiles, isRepo } from "../core/git.js";
import { readText } from "../core/fs.js";
import { rankFiles } from "../core/repomap.js";
import { allSourceFiles, type Selection } from "../core/select.js";
import { extractSymbols, SOURCE_EXTENSIONS } from "../adapters/symbols.js";
import { escapeRegExp } from "../core/text.js";

/** Reviewer context, not a full call graph — keeps the pack bounded. */
const MAX_EXPANSION = 10;
/** Symbols shorter than this (`x`, `run`, `id`, …) are too generic to signal a real reference. */
const MIN_SYMBOL_LEN = 4;


/**
 * `select()`'s `diff` branch. Degradation per §6-C: not a git repository or
 * an invalid/unreachable range both raise a clear, named error rather than
 * an empty or exception-y pack.
 */
export function diffSelection(config: CtxConfig, range: string): Selection {
  if (!isRepo(config.root)) {
    throw new Error(
      `pack --diff requires a git repository (docs/plan-v2.md §6-C) — "${config.root}" is not one`,
    );
  }

  let changed: string[];
  try {
    changed = diffFiles(config.root, range);
  } catch {
    throw new Error(
      `pack --diff: invalid or unreachable range "${range}" — a shallow clone or a typo in the ` +
        `revision(s) are the usual cause; try "git diff --name-only ${range}" to confirm it resolves`,
    );
  }

  const label = `diff:${range}`;
  const seedSet = new Set(changed.filter((f) => SOURCE_EXTENSIONS.has(extname(f))));
  if (seedSet.size === 0) {
    // Nothing source-shaped changed (docs/config only, or an empty range).
    // Not an error — a review pack with zero code seeds is still valid.
    return { files: [], seeds: [], label };
  }

  // Order the seeds themselves by how much the changed files reference one
  // another, so "the top-ranked seed" (used when seeds alone blow the
  // budget, core/pack.ts) means something rather than being alphabetical.
  const seeds = rankFiles(config, { files: [...seedSet] }).map((e) => e.rel);

  // Gather the seeds' symbol names to look for elsewhere in the repo.
  const symbolNames = new Set<string>();
  for (const rel of seeds) {
    const text = readText(config.root, rel);
    if (text === null) continue;
    for (const sym of extractSymbols(rel, text)) {
      if (sym.name.length >= MIN_SYMBOL_LEN) symbolNames.add(sym.name);
    }
  }

  // Rank every other source file by how many times it references those
  // symbols — the expansion set.
  const expansion: string[] = [];
  if (symbolNames.size > 0) {
    const re = new RegExp(`\\b(?:${[...symbolNames].map(escapeRegExp).join("|")})\\b`, "g");
    const scored: { rel: string; score: number }[] = [];
    for (const rel of allSourceFiles(config)) {
      if (seedSet.has(rel)) continue;
      const text = readText(config.root, rel);
      if (text === null) continue;
      const matches = text.match(re);
      if (matches && matches.length > 0) scored.push({ rel, score: matches.length });
    }
    scored.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
    expansion.push(...scored.slice(0, MAX_EXPANSION).map((s) => s.rel));
  }

  return { files: [...seeds, ...expansion], seeds, label };
}
