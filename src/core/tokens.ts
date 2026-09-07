/**
 * Approximate token counting. Deliberately dependency-free: a chars/4
 * heuristic is within ~20% for ASCII-ish source code, which is enough for
 * budget decisions. It badly UNDERESTIMATES CJK text (Korean/Japanese/
 * Chinese cost closer to one BPE token per character than one per four),
 * so codepoints in the CJK ranges below are counted at a separate, higher
 * rate. This keeps the ASCII path byte-for-byte identical to the old
 * formula while removing most of the CJK error at zero cost.
 *
 * An exact adapter (BPE tokenizer, optional dependency) lives in
 * src/adapters/tokenizer.ts and can replace this later without touching
 * callers — this function's signature is load-bearing across the codebase.
 */

/** Inclusive [lo, hi] codepoint ranges treated as "CJK": Hangul syllables
 *  and jamo, CJK unified ideographs (+ common extensions/compatibility),
 *  Hiragana, Katakana, and full-width forms. */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana (+ Katakana Phonetic Extensions below)
  [0x3130, 0x318f], // Hangul Compatibility Jamo
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xd7b0, 0xd7ff], // Hangul Jamo Extended-B
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
  [0x31f0, 0x31ff], // Katakana Phonetic Extensions
  [0x20000, 0x2fffd], // CJK Unified Ideographs Extensions B-F (astral)
];

function isCJK(codePoint: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** Measured against gpt-tokenizer (cl100k_base BPE) by isolating the CJK
 *  codepoints from five Korean-commented Python files (8,649 CJK chars
 *  total) and re-encoding them alone: 8,256 tokens, a 0.955 tokens/char
 *  ratio, consistent across files (0.939-0.956). 0.95 is the resulting
 *  constant — close to "1 token per character" as expected for Hangul/CJK
 *  under BPE, and far closer to reality than chars/4's implicit 0.25. */
const CJK_TOKENS_PER_CHAR = 0.95;

export function approxTokens(text: string): number {
  let cjkChars = 0;
  let otherUnits = 0;
  for (const ch of text) {
    // Iterating with for..of walks by codepoint (handles surrogate pairs),
    // so astral CJK codepoints count as one "character" here.
    const cp = ch.codePointAt(0)!;
    if (isCJK(cp)) {
      cjkChars++;
    } else {
      otherUnits += ch.length; // UTF-16 code units, matching text.length for non-CJK-only text
    }
  }
  return Math.ceil(otherUnits / 4) + Math.ceil(cjkChars * CJK_TOKENS_PER_CHAR);
}
