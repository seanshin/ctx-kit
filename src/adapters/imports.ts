/**
 * Per-language import extraction (docs/plan-v2.md §4.2, `must_not_import`).
 *
 * Every extractor returns the raw specifier text as written — the input to
 * stage ① (direct match against a forbidden pattern) — plus a repo-relative
 * `resolved` path when, and only when, the specifier is a relative path
 * (`./x`, `../x`, or Python's leading-dot `from . import x`) that can be
 * probed against the filesystem. Bare or aliased specifiers ("twin.db",
 * "@scope/pkg", "github.com/x/y") are never resolved — most importantly,
 * **tsconfig `paths` and monorepo workspace aliases are not resolved**; only
 * stage ① (raw text matching) can catch those, and callers should say so in
 * any violation message (docs/plan-v2.md §4.2).
 */
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";

export interface ImportRef {
  /** Text exactly as written in the source, e.g. "../db/client", "twin.db". */
  specifier: string;
  /** Repo-relative resolved file, or null when not resolvable (see above). */
  resolved: string | null;
  line: number;
}

/** Extensions probed when a relative specifier has none of its own. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"];

const KNOWN_RUNNER_LANGS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"]);

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

function existingFile(root: string, rel: string): string | null {
  const full = join(root, rel);
  try {
    if (existsSync(full) && statSync(full).isFile()) return toPosix(rel);
  } catch {
    /* unreadable — treat as not found */
  }
  return null;
}

/**
 * Resolve a "./" or "../" style specifier from `fromFile`, probing known
 * extensions and falling back to `index.*` / `__init__.py`.
 */
function resolveRelative(root: string, fromFile: string, specifier: string): string | null {
  const fromDir = dirname(fromFile);
  const target = toPosix(join(fromDir, specifier));
  const candidates: string[] = [];
  if (extname(target)) candidates.push(target); // specifier already names an extension
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(target + ext);
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(toPosix(join(target, "index" + ext)));
  candidates.push(toPosix(join(target, "__init__.py")));
  for (const c of candidates) {
    const hit = existingFile(root, c);
    if (hit) return hit;
  }
  return null;
}

/** Resolve a Python leading-dot relative import: ".", ".foo", "..foo.bar". */
function resolvePythonRelative(root: string, fromFile: string, specifier: string): string | null {
  const m = /^(\.+)(.*)$/.exec(specifier);
  if (!m) return null;
  const dots = m[1].length;
  const rest = m[2]; // "" | "foo" | "foo.bar"
  let baseDir = dirname(fromFile);
  for (let i = 1; i < dots; i++) baseDir = dirname(baseDir);
  const restPath = rest ? rest.split(".").join("/") : "";
  const target = restPath ? toPosix(join(baseDir, restPath)) : toPosix(baseDir);
  const candidates = rest ? [`${target}.py`, toPosix(join(target, "__init__.py"))] : [toPosix(join(target, "__init__.py"))];
  for (const c of candidates) {
    const hit = existingFile(root, c);
    if (hit) return hit;
  }
  return null;
}

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") offsets.push(i + 1);
  return offsets;
}

function lineAt(offsets: number[], index: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// `from ... "x"` covers both `import ... from "x"` and `export ... from "x"`;
// the rest cover forms with no "from" clause.
const JS_SPECIFIER_RES: RegExp[] = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function extractJs(root: string, relPath: string, content: string): ImportRef[] {
  const offsets = lineOffsets(content);
  const seen = new Map<string, ImportRef>();
  for (const re of JS_SPECIFIER_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const specifier = m[1];
      const line = lineAt(offsets, m.index);
      const key = `${line}:${specifier}`;
      if (seen.has(key)) continue;
      const resolved = specifier.startsWith(".") ? resolveRelative(root, relPath, specifier) : null;
      seen.set(key, { specifier, resolved, line });
    }
  }
  return [...seen.values()].sort((a, b) => a.line - b.line);
}

function extractPy(root: string, relPath: string, content: string): ImportRef[] {
  const out: ImportRef[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromM = /^\s*from\s+(\.*[\w.]*)\s+import\b/.exec(line);
    if (fromM) {
      const specifier = fromM[1];
      const resolved = specifier.startsWith(".") ? resolvePythonRelative(root, relPath, specifier) : null;
      out.push({ specifier, resolved, line: i + 1 });
      continue;
    }
    const importM = /^\s*import\s+(.+)$/.exec(line);
    if (importM) {
      for (const part of importM[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) out.push({ specifier: name, resolved: null, line: i + 1 });
      }
    }
  }
  return out;
}

function extractGo(relPath: string, content: string): ImportRef[] {
  const out: ImportRef[] = [];
  const lines = content.split("\n");
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      const single = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/.exec(line);
      if (single) {
        out.push({ specifier: single[1], resolved: null, line: i + 1 });
        continue;
      }
      if (/^\s*import\s*\($/.test(line)) inBlock = true;
      continue;
    }
    if (/^\s*\)\s*$/.test(line)) {
      inBlock = false;
      continue;
    }
    const m = /^\s*(?:\w+\s+)?"([^"]+)"/.exec(line);
    if (m) out.push({ specifier: m[1], resolved: null, line: i + 1 });
  }
  return out;
}

function extractRs(relPath: string, content: string): ImportRef[] {
  const out: ImportRef[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const useM = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/.exec(line);
    if (useM) {
      out.push({ specifier: useM[1].trim(), resolved: null, line: i + 1 });
      continue;
    }
    const modM = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/.exec(line);
    if (modM) out.push({ specifier: modM[1], resolved: null, line: i + 1 });
  }
  return out;
}

/** relPath decides the language; unsupported extensions return no imports. */
export function extractImports(root: string, relPath: string, content: string): ImportRef[] {
  const ext = extname(relPath);
  if (!KNOWN_RUNNER_LANGS.has(ext)) return [];
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return extractJs(root, relPath, content);
    case ".py":
      return extractPy(root, relPath, content);
    case ".go":
      return extractGo(relPath, content);
    case ".rs":
      return extractRs(relPath, content);
    default:
      return [];
  }
}
