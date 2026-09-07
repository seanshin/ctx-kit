/**
 * Optional exact-tokenizer adapter.
 *
 * "Reduced-capability core" (AGENTS.md): ctx-kit works with zero external
 * packages installed. `approxTokens` in core/tokens.ts is the dependency-
 * free default everywhere in the codebase. This adapter is an opt-in
 * accelerator: when gpt-tokenizer (MIT — github.com/niieani/gpt-tokenizer,
 * verified via `npm view gpt-tokenizer license`) is installed, it returns
 * an exact BPE count instead of the heuristic. It is never a hard
 * dependency — see optionalDependencies in package.json — and every export
 * here falls back to `approxTokens` and never throws when the package is
 * absent, so the fallback path is always safe to call.
 *
 * Not wired into pack.ts/repomap.ts/get.ts: those run approxTokens
 * synchronously in tight budget loops, and a dynamic import is inherently
 * async. This adapter is for callers that can afford to await an exact
 * count (e.g. a future `--exact-tokens` CLI/MCP flag, or offline
 * measurement) without forcing every hot-path caller to become async.
 */
import { approxTokens } from "../core/tokens.js";

type Encoder = (text: string) => ArrayLike<number>;

// undefined = not yet probed; null = probed and unavailable.
let cachedEncode: Encoder | null | undefined;

async function loadEncoder(): Promise<Encoder | null> {
  if (cachedEncode !== undefined) return cachedEncode;
  try {
    // Dynamic import via a non-literal specifier: TypeScript only attempts
    // module/type resolution for string-literal import() targets, so this
    // form type-checks (as `any`) even when gpt-tokenizer's types are not
    // installed — required for `tsc` to build with zero optional packages
    // present. At runtime, import() of an absent package rejects with
    // ERR_MODULE_NOT_FOUND, which we treat as "not installed".
    const specifier = "gpt-tokenizer";
    const mod: any = await import(specifier);
    const encode = mod?.encode ?? mod?.default?.encode;
    cachedEncode = typeof encode === "function" ? (encode as Encoder) : null;
  } catch {
    cachedEncode = null;
  }
  return cachedEncode;
}

/** True when gpt-tokenizer is installed and importable. */
export async function exactTokenizerAvailable(): Promise<boolean> {
  return (await loadEncoder()) !== null;
}

/**
 * Exact BPE token count via gpt-tokenizer when installed; otherwise the
 * dependency-free heuristic from core/tokens.ts. Always resolves — an
 * encode-time failure also falls back rather than throwing, so this is
 * safe to call unconditionally.
 */
export async function countTokens(text: string): Promise<number> {
  const encode = await loadEncoder();
  if (encode) {
    try {
      return encode(text).length;
    } catch {
      // fall through to the heuristic on any encode-time failure
    }
  }
  return approxTokens(text);
}
