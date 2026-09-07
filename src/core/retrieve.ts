/**
 * Dependency-free tokenization + per-field BM25 (plan §4.4, stream B).
 *
 * No embeddings, no external index: file-level location finding reaches
 * 87.7% Top-30 recall with BM25 alone (plan §4.4 references), so this file
 * is the whole retrieval engine `scorers/query.ts` composes into a ranking
 * signal.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "he", "in", "is", "it", "its", "of", "on", "or", "that", "the",
  "this", "to", "was", "were", "will", "with", "not", "but", "can", "if",
  "into", "than", "then", "so", "such", "which", "what", "when", "where",
  "who", "how", "do", "does", "did", "you", "your", "we", "our",
]);

// Hiragana/Katakana (぀-ヿ), CJK Unified Ideographs + extension A
// (㐀-䶿, 一-鿿), Hangul syllables (가-힣), CJK
// compatibility ideographs (豈-﫿).
const CJK_CHAR_RE = /[぀-ヿ㐀-䶿一-鿿가-힣豈-﫿]/;
const RUN_RE = /[぀-ヿ㐀-䶿一-鿿가-힣豈-﫿]+|[A-Za-z0-9]+/g;

/**
 * Split a camelCase/PascalCase run into its parts, including acronym runs
 * (`XMLParser` -> `XML`, `Parser`). Whitespace/punctuation splitting
 * (including snake_case's `_` and kebab-case's `-`) already happened via
 * `RUN_RE`, since those separators fall outside `[A-Za-z0-9]`.
 */
function splitCompoundWord(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
}

/**
 * Tokenize text for BM25 indexing (identifiers) or querying (task
 * descriptions) — the same function is used on both sides so a query term
 * and an identifier collide on the same tokens.
 *
 * Latin-script runs: split on whitespace/punctuation (including `_`/`-`,
 * which sit outside the run pattern), split camelCase/PascalCase, lowercase,
 * drop stopwords and tokens under 2 characters.
 *
 * CJK runs are indexed as character bigrams instead — Lucene's CJKAnalyzer
 * technique, and the standard answer for Korean/Japanese/Chinese queries
 * without a morphological analyzer: 할인율을 ("the discount rate", with a
 * particle) and 할인율 (without it) both produce the bigram 할인, so a
 * particle change does not break the match. A lone leftover CJK character
 * (an odd-length run) is kept as-is rather than dropped.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.match(RUN_RE) ?? []) {
    if (CJK_CHAR_RE.test(run)) {
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
      }
      continue;
    }
    for (const piece of splitCompoundWord(run)) {
      const t = piece.toLowerCase();
      if (t.length >= 2 && !STOPWORDS.has(t)) tokens.push(t);
    }
  }
  return tokens;
}

export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export interface Bm25Options {
  /** Term frequency saturation. Plan default 1.2. */
  k1?: number;
  /** Length normalization. Plan default 0.75 for body, 0.5 for path/symbols. */
  b?: number;
}

/**
 * Per-field Okapi BM25 (Robertson & Zaragoza 2009):
 *
 *   idf(t)   = max(0, ln((N - df + 0.5) / (df + 0.5) + 1))
 *   bm25(F)  = Σ_t idf(t) · tf(t,F)·(k1+1) / (tf(t,F) + k1·(1−b+b·|F|/avgLen))
 *
 * Returns a raw (unnormalized) score per document id — one field's worth.
 * `scorers/query.ts` runs this once per field (its own `b`, its own avg
 * length) and combines the results by a fixed weight; concatenating fields
 * into one document instead would let a long body field dilute the
 * path/symbol signal in the length normalization (plan §4.4).
 */
export function bm25(docs: Bm25Doc[], queryTerms: string[], opts: Bm25Options = {}): Map<string, number> {
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const scores = new Map<string, number>();
  const N = docs.length;
  const terms = [...new Set(queryTerms)];
  if (N === 0 || terms.length === 0) return scores;

  const df = new Map<string, number>();
  const tf = new Map<string, Map<string, number>>();
  const len = new Map<string, number>();
  let totalLen = 0;

  for (const doc of docs) {
    const counts = new Map<string, number>();
    for (const t of doc.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    tf.set(doc.id, counts);
    len.set(doc.id, doc.tokens.length);
    totalLen += doc.tokens.length;
    for (const t of terms) {
      if (counts.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const avgLen = totalLen / N;

  const idf = new Map<string, number>();
  for (const t of terms) {
    const d = df.get(t) ?? 0;
    idf.set(t, Math.max(0, Math.log((N - d + 0.5) / (d + 0.5) + 1)));
  }

  for (const doc of docs) {
    let score = 0;
    const counts = tf.get(doc.id)!;
    const docLen = len.get(doc.id)!;
    for (const t of terms) {
      const f = counts.get(t) ?? 0;
      if (f === 0) continue;
      const denom = f + k1 * (1 - b + (avgLen > 0 ? b * (docLen / avgLen) : 0));
      score += (idf.get(t) ?? 0) * ((f * (k1 + 1)) / denom);
    }
    scores.set(doc.id, score);
  }
  return scores;
}
