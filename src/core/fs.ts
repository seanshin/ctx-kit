import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import picomatch from "picomatch";
import { BUILTIN_IGNORE_DIRS } from "./config.js";

export interface WalkOptions {
  /** Glob patterns (relative to root); when set, only matching files are returned. */
  include?: string[];
  /** Glob patterns excluded in addition to built-in ignores. */
  exclude?: string[];
  /** Files larger than this are skipped (default 512 KiB). */
  maxFileBytes?: number;
}

export function walkFiles(root: string, opts: WalkOptions = {}): string[] {
  const isExcluded = opts.exclude?.length
    ? picomatch(opts.exclude, { dot: true })
    : null;
  const isIncluded = opts.include?.length
    ? picomatch(opts.include, { dot: true })
    : null;
  const maxBytes = opts.maxFileBytes ?? 512 * 1024;
  const out: string[] = [];

  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (isExcluded?.(rel)) continue;
      if (entry.isDirectory()) {
        if (BUILTIN_IGNORE_DIRS.has(entry.name)) continue;
        visit(full);
      } else if (entry.isFile()) {
        if (isIncluded && !isIncluded(rel)) continue;
        try {
          if (statSync(full).size > maxBytes) continue;
        } catch {
          continue;
        }
        out.push(rel);
      }
    }
  };

  visit(root);
  return out.sort();
}

/** Read a file as UTF-8 text; returns null for binary or unreadable files. */
export function readText(root: string, rel: string): string | null {
  try {
    const buf = readFileSync(join(root, rel));
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}
