/**
 * Repository health — docs/plan-v2.md §4.2. Four sub-checks: machine-checked
 * `constraints` (always `fail` on violation), duplicate definitions,
 * orphaned files and module coverage (the latter three configurable via
 * `health:` in context.config.yaml, default warn/warn/info).
 */
import { extname } from "node:path";
import picomatch from "picomatch";
import { readText, walkFiles } from "../core/fs.js";
import { SOURCE_EXTENSIONS, type CodeSymbol } from "../adapters/symbols.js";
import { extractImports } from "../adapters/imports.js";
import type { CtxConfig } from "../core/config.js";
import type { RankedFile } from "../core/repomap.js";
import type { Check, CheckContext, CheckResult } from "./types.js";

// Same demotion the repo map uses for test files (docs/plan-v2.md §4.2: test
// paths are excluded before every subsequent filter stage).
const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|(^|\/)(test_[^/]*|conftest)\.py$|\.(test|spec)\.[jt]sx?$/;

const ENTRY_POINT_NAMES = new Set([
  "main", "index", "cli", "app", "__main__", "server", "worker", "setup", "conftest",
  // Next.js file-system routing conventions.
  "page", "layout", "route", "middleware",
]);

function isEntryPoint(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  const name = base.replace(/\.[^.]+$/, "");
  return ENTRY_POINT_NAMES.has(name);
}

function isDunder(name: string): boolean {
  return /^__.+__$/.test(name);
}

function normalizeSignature(sig: string): string {
  return sig.replace(/\s+/g, "");
}

// Distinct name from adapters' own escapeRegExp-style helpers on purpose:
// naming it the same would make this file itself a third duplicate of the
// very pattern the duplicate check below is designed to catch.
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* -------------------------------------------------------------------- */
/* (1) constraint conformance                                            */
/* -------------------------------------------------------------------- */

function checkConstraints(config: CtxConfig, entries: RankedFile[]): CheckResult[] {
  if (config.constraints.length === 0) {
    return [{ level: "ok", name: "constraint", detail: "constraint check skipped: no constraints defined" }];
  }
  const results: CheckResult[] = [];
  for (const c of config.constraints) {
    const before = results.length;
    if (c.symbol && c.only_in) {
      const allow = picomatch(c.only_in, { dot: true });
      for (const entry of entries) {
        for (const sym of entry.symbols) {
          if (sym.name === c.symbol && !allow(entry.rel)) {
            results.push({
              level: "fail",
              name: "constraint",
              detail: `[${c.id}] "${c.symbol}" defined at ${entry.rel}:${sym.line}, but only_in allows ${c.only_in.join(", ")}`,
              location: { file: entry.rel, line: sym.line },
              subject: c.id,
            });
          }
        }
      }
    } else if (c.from && c.must_not_import) {
      const from = picomatch(c.from, { dot: true });
      const deny = picomatch(c.must_not_import, { dot: true });
      for (const entry of entries) {
        if (!from(entry.rel)) continue;
        const text = readText(config.root, entry.rel);
        if (text === null) continue;
        for (const imp of extractImports(config.root, entry.rel, text)) {
          // Stage ①: raw specifier text, plus a dotted->slashed form so
          // Python's `from twin.db import x` can match a slash-style glob.
          const rawHit = deny(imp.specifier) || deny(imp.specifier.split(".").join("/"));
          // Stage ②: the specifier resolved to an actual repo file.
          const resolvedHit = imp.resolved !== null && deny(imp.resolved);
          if (rawHit || resolvedHit) {
            results.push({
              level: "fail",
              name: "constraint",
              detail:
                `[${c.id}] ${entry.rel}:${imp.line} imports "${imp.specifier}"` +
                (imp.resolved ? ` (resolved: ${imp.resolved})` : "") +
                ` — forbidden by must_not_import ${c.must_not_import.join(", ")}` +
                ` (tsconfig paths and workspace aliases are not resolved; only literal/relative specifiers are checked)`,
              location: { file: entry.rel, line: imp.line },
              subject: c.id,
            });
          }
        }
      }
    } else if (c.forbid_pattern && c.in) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(c.forbid_pattern);
      } catch (err) {
        results.push({
          level: "fail",
          name: "constraint",
          detail: `[${c.id}] invalid forbid_pattern: ${err instanceof Error ? err.message : String(err)}`,
          subject: c.id,
        });
      }
      if (re) {
        for (const rel of walkFiles(config.root, { include: c.in, exclude: config.exclude })) {
          const text = readText(config.root, rel);
          if (text === null) continue;
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              results.push({
                level: "fail",
                name: "constraint",
                detail: `[${c.id}] forbidden pattern /${c.forbid_pattern}/ found at ${rel}:${i + 1}`,
                location: { file: rel, line: i + 1 },
                subject: c.id,
              });
            }
          }
        }
      }
    }
    if (results.length === before) {
      results.push({ level: "ok", name: "constraint", detail: `[${c.id}] satisfied` });
    }
  }
  return results;
}

/* -------------------------------------------------------------------- */
/* (2) duplicate definitions — measured filter chain (plan-v2 §4.2)      */
/* -------------------------------------------------------------------- */

interface SymOcc {
  rel: string;
  symbol: CodeSymbol;
}

/**
 * same name in >=2 files -> exclude test paths -> top-level only ->
 * name length >=4 and not dunder -> identical signature (whitespace
 * stripped). Order among the independent filters does not affect the
 * result; only the final "still >=2 files" grouping (by name, then by
 * normalized signature) has to run last.
 */
function findDuplicates(entries: RankedFile[]): Map<string, SymOcc[]> {
  const byName = new Map<string, SymOcc[]>();
  for (const entry of entries) {
    if (TEST_PATH_RE.test(entry.rel)) continue;
    for (const symbol of entry.symbols) {
      if (!symbol.topLevel) continue;
      if (symbol.name.length < 4 || isDunder(symbol.name)) continue;
      const list = byName.get(symbol.name) ?? [];
      list.push({ rel: entry.rel, symbol });
      byName.set(symbol.name, list);
    }
  }

  const duplicates = new Map<string, SymOcc[]>();
  for (const [name, occs] of byName) {
    if (new Set(occs.map((o) => o.rel)).size < 2) continue;
    const bySig = new Map<string, SymOcc[]>();
    for (const o of occs) {
      // A constant carries no signature, so "identical signature" is
      // vacuously true for any two same-named consts and the filter
      // degenerates — measured on this repo, `DEFAULT_PROFILES` in
      // config.ts (a profile record) matched the unrelated one in eval.ts
      // (a name list). Duplicate *implementation* is a claim about
      // callable code, so require a real parameter list.
      const sigKey = normalizeSignature(o.symbol.signature);
      if (sigKey === "") continue;
      const l = bySig.get(sigKey) ?? [];
      l.push(o);
      bySig.set(sigKey, l);
    }
    for (const group of bySig.values()) {
      if (new Set(group.map((g) => g.rel)).size >= 2) {
        duplicates.set(name, [...(duplicates.get(name) ?? []), ...group]);
      }
    }
  }
  return duplicates;
}

/* -------------------------------------------------------------------- */
/* (3) orphans — zero external references                                */
/* -------------------------------------------------------------------- */

/**
 * A file counts as referenced when any of its own symbols (name length >=4,
 * matching the signal threshold used elsewhere in this codebase) appears as
 * a whole-word match in some *other* file's text. This mirrors the
 * cross-file reference scan `core/repomap.ts` already runs for ranking;
 * it is re-derived here rather than imported because repomap.ts does not
 * export it (and is outside this stream's ownership) — expect roughly
 * double the reference-scanning cost of `check` on very large repos.
 */
function findReferencedFiles(entries: RankedFile[], contents: Map<string, string>): Set<string> {
  const referenced = new Set<string>();
  for (const entry of entries) {
    let hit = false;
    for (const sym of entry.symbols) {
      if (sym.name.length < 4) continue;
      const re = new RegExp(`\\b${reEscape(sym.name)}\\b`, "g");
      for (const [otherRel, text] of contents) {
        if (otherRel === entry.rel) continue;
        if (re.test(text)) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) referenced.add(entry.rel);
  }
  return referenced;
}

interface OrphanResult {
  orphans: string[];
  skippedNoSymbols: number;
}

function findOrphans(config: CtxConfig, entries: RankedFile[], referenced: Set<string>): OrphanResult {
  const ignore = config.health.orphan_ignore.length
    ? picomatch(config.health.orphan_ignore, { dot: true })
    : null;
  let skippedNoSymbols = 0;
  const orphans: string[] = [];
  for (const entry of entries) {
    if (TEST_PATH_RE.test(entry.rel)) continue;
    if (isEntryPoint(entry.rel)) continue;
    if (ignore?.(entry.rel)) continue;
    if (entry.symbols.length === 0) {
      // Extraction failure and genuine disuse are indistinguishable from
      // here, so a symbol-less file must never be reported as an orphan
      // (docs/plan-v2.md §4.2, §6-C).
      skippedNoSymbols++;
      continue;
    }
    if (!referenced.has(entry.rel)) orphans.push(entry.rel);
  }
  return { orphans, skippedNoSymbols };
}

/* -------------------------------------------------------------------- */
/* (4) coverage — files matching no module glob                          */
/* -------------------------------------------------------------------- */

function findUncovered(config: CtxConfig, entries: RankedFile[]): string[] {
  const moduleGlobs = Object.values(config.modules);
  if (moduleGlobs.length === 0) return [];
  const matchers = moduleGlobs.map((globs) => picomatch(globs, { dot: true }));
  return entries.filter((e) => !matchers.some((m) => m(e.rel))).map((e) => e.rel);
}

/* -------------------------------------------------------------------- */

export const healthCheck: Check = {
  name: "health",
  run(ctx: CheckContext): CheckResult[] {
    const { config } = ctx;
    const results: CheckResult[] = [];

    results.push(...checkConstraints(config, ctx.ranked()));

    // Only source-extension files participate in duplicate/orphan/coverage
    // — the same universe `ranked()` already scans.
    const entries = ctx.ranked().filter((e) => SOURCE_EXTENSIONS.has(extname(e.rel)));

    const duplicates = findDuplicates(entries);
    if (duplicates.size === 0) {
      results.push({ level: "ok", name: "duplicate", detail: "no duplicate definitions found" });
    } else {
      for (const [name, occs] of duplicates) {
        const files = [...new Set(occs.map((o) => o.rel))].sort();
        results.push({
          level: config.health.duplicates,
          name: "duplicate",
          detail: `"${name}" defined identically in ${files.join(", ")}`,
          location: { file: files[0] },
          subject: name,
        });
      }
    }

    const contents = new Map<string, string>();
    for (const entry of entries) {
      const text = readText(config.root, entry.rel);
      if (text !== null) contents.set(entry.rel, text);
    }
    const referenced = findReferencedFiles(entries, contents);
    const { orphans, skippedNoSymbols } = findOrphans(config, entries, referenced);
    if (orphans.length === 0) {
      results.push({
        level: "ok",
        name: "orphan",
        detail: `no orphaned files found (${skippedNoSymbols} file(s) with 0 extracted symbols held back — extraction failure is indistinguishable from disuse)`,
      });
    } else {
      for (const rel of orphans) {
        results.push({
          level: config.health.orphans,
          name: "orphan",
          detail: `${rel} has zero external references`,
          location: { file: rel },
          subject: rel,
        });
      }
    }

    const uncovered = findUncovered(config, entries);
    if (Object.keys(config.modules).length === 0) {
      results.push({ level: "ok", name: "coverage", detail: "coverage check skipped: no modules defined" });
    } else if (uncovered.length === 0) {
      results.push({ level: "ok", name: "coverage", detail: "every source file is covered by a module" });
    } else {
      for (const rel of uncovered) {
        results.push({
          level: config.health.coverage,
          name: "coverage",
          detail: `${rel} matches no module glob`,
          location: { file: rel },
          subject: rel,
        });
      }
    }

    return results;
  },
};
