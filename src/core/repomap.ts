/**
 * Tier 1: repository map builder.
 *
 * Ranks files by how often their exported symbols are referenced from other
 * files (a simplified take on aider's tree-sitter + PageRank approach —
 * algorithm inspiration only, no code reuse), then emits the most important
 * files' symbol outlines within a token budget.
 */
import { extname } from "node:path";
import type { CtxConfig } from "./config.js";
import { readText, walkFiles } from "./fs.js";
import { approxTokens } from "./tokens.js";
import { escapeRegExp } from "./text.js";
import { SOURCE_EXTENSIONS, extractSymbols, type CodeSymbol } from "../adapters/symbols.js";

export interface RepoMapOptions {
  budget?: number;
  /** Restrict the map to these files (repo-relative), e.g. one module. */
  files?: string[];
  /** Scope label for the header, e.g. a module name. */
  scope?: string;
}

export interface RankedFile {
  rel: string;
  symbols: CodeSymbol[];
  score: number;
}

const COMMON_NAMES = new Set([
  "main", "init", "test", "setup", "index", "data", "name", "type", "value",
  "get", "set", "run", "new", "update", "create", "delete", "read", "write",
]);


/**
 * Test files score artificially high (conftest fixtures are referenced by
 * every test; test files define many symbols), but an agent orienting in a
 * codebase needs production code first — demote them.
 */
const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|(^|\/)(test_[^/]*|conftest)\.py$|\.(test|spec)\.[jt]sx?$/;

/**
 * An additional ranking signal. Returns a per-file contribution already
 * normalized to roughly 0..1; `rankFiles` adds it to the reference score.
 *
 * Work streams add scorers as their own files (query, co-change) rather
 * than editing this one — see docs/plan-v2.md §8-B.2.
 */
export type Scorer = (files: RankedFile[], config: CtxConfig) => Map<string, number>;

export interface RankOptions {
  /** Restrict ranking to these files (e.g. one module). */
  files?: string[];
  /** Extra signals added on top of the reference score. */
  scorers?: Scorer[];
}

/**
 * Score and sort files by cross-file symbol references. When `opts.files` is
 * given (e.g. one module's files), references are counted within that set.
 */
export function rankFiles(config: CtxConfig, opts: RankOptions = {}): RankedFile[] {
  const files =
    opts.files ??
    walkFiles(config.root, { exclude: config.exclude }).filter((f) =>
      SOURCE_EXTENSIONS.has(extname(f)),
    );

  const contents = new Map<string, string>();
  const entries: RankedFile[] = [];
  for (const rel of files) {
    const text = readText(config.root, rel);
    if (text === null) continue;
    contents.set(rel, text);
    entries.push({ rel, symbols: extractSymbols(rel, text), score: 0 });
  }

  // Cross-file reference counting (capped to keep the naive scan bounded).
  for (const entry of entries) {
    for (const sym of entry.symbols) {
      if (sym.name.length < 4 || COMMON_NAMES.has(sym.name.toLowerCase())) continue;
      const re = new RegExp(`\\b${escapeRegExp(sym.name)}\\b`, "g");
      for (const [otherRel, text] of contents) {
        if (otherRel === entry.rel) continue;
        const matches = text.match(re);
        if (matches) entry.score += Math.min(matches.length, 20);
      }
    }
    entry.score += Math.min(entry.symbols.length, 10) * 0.5; // mild self-weight, capped
  }

  const scorers = opts.scorers ?? [];
  if (scorers.length > 0) {
    // Normalize the reference score before adding scorer contributions.
    // Raw reference scores span 0..~80 on a densely cross-referenced repo
    // while a scorer contributes 0..weight, so an un-normalized base simply
    // swamps the extra signal — measured: a query term moved a file by two
    // places out of thirty. Normalization is monotonic, so the no-scorer
    // path below keeps its exact ordering *and* its absolute values, which
    // other callers (health checks) read.
    const maxRef = Math.max(...entries.map((e) => e.score), 0);
    if (maxRef > 0) for (const entry of entries) entry.score /= maxRef;

    for (const scorer of scorers) {
      const contribution = scorer(entries, config);
      for (const entry of entries) entry.score += contribution.get(entry.rel) ?? 0;
    }
  }

  // Demote tests last, so the demotion covers every signal. Applying it to
  // the reference score alone let a query lift a test file to first place
  // past the implementation it tests — the exact ordering the rule exists to
  // prevent. With no scorers this is the same multiplication as before, on
  // the same value, so the plain ranking is unchanged.
  for (const entry of entries) {
    if (TEST_PATH_RE.test(entry.rel)) entry.score *= 0.2;
  }

  entries.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  return entries;
}

export function buildRepoMap(config: CtxConfig, opts: RepoMapOptions = {}): string {
  const budget = opts.budget ?? 8000;
  const entries = rankFiles(config, { files: opts.files });

  const header = [
    `<!-- ctxkit:v1 repomap generated=${new Date().toISOString()} budget=${budget}` +
      (opts.scope ? ` scope=${opts.scope}` : "") +
      ` -->`,
    opts.scope ? `# Repository Map: ${opts.scope}` : `# Repository Map`,
    ``,
    `Files: ${entries.length} source files scanned. Ranked by cross-file references.`,
    ``,
    ``,
  ].join("\n");

  let out = header;
  let included = 0;
  for (const entry of entries) {
    const lines = [`## ${entry.rel}`];
    if (entry.symbols.length === 0) {
      lines.push(`- (no extractable symbols)`);
    } else {
      for (const s of entry.symbols) {
        const sig = s.signature ? `${s.name}${s.signature}` : s.name;
        lines.push(`- L${s.line} ${s.kind} \`${sig}\``);
      }
    }
    const block = lines.join("\n") + "\n\n";
    if (approxTokens(out + block) > budget) break;
    out += block;
    included++;
  }

  if (included < entries.length) {
    out += `_…${entries.length - included} lower-ranked files omitted (budget ${budget} tokens)._\n`;
  }
  return out;
}
