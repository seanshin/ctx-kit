/**
 * Approximate token counting. Deliberately dependency-free: a chars/4
 * heuristic is within ~20% for source code, which is enough for budget
 * decisions. A tokenizer adapter can replace this later without touching
 * callers.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
