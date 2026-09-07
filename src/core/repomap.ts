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
import { SOURCE_EXTENSIONS, extractSymbols, type CodeSymbol } from "../adapters/symbols.js";

export interface RepoMapOptions {
  budget?: number;
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Test files score artificially high (conftest fixtures are referenced by
 * every test; test files define many symbols), but an agent orienting in a
 * codebase needs production code first — demote them.
 */
const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|(^|\/)(test_[^/]*|conftest)\.py$|\.(test|spec)\.[jt]sx?$/;

/**
 * Score and sort files by cross-file symbol references. When `relFiles` is
 * given (e.g. one module's files), references are counted within that set.
 */
export function rankFiles(config: CtxConfig, relFiles?: string[]): RankedFile[] {
  const files =
    relFiles ??
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
    if (TEST_PATH_RE.test(entry.rel)) entry.score *= 0.2;
  }

  entries.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  return entries;
}

export function buildRepoMap(config: CtxConfig, opts: RepoMapOptions = {}): string {
  const budget = opts.budget ?? 8000;
  const entries = rankFiles(config);

  const header = [
    `<!-- ctxkit:v1 repomap generated=${new Date().toISOString()} budget=${budget} -->`,
    `# Repository Map`,
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
