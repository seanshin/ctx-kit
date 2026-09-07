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
 * Tokens under this length are never stemmed — short words carry too little
 * redundant suffix material to fold safely ("as", "is", "gas" losing a
 * trailing "s" would just be wrong).
 */
const STEM_MIN_LEN = 4;

/**
 * A task-description query naturally lands on a different inflection than
 * the identifier it should match ("scanning" vs. `Scans`, "secret" vs.
 * `secrets`), so a handful of literal false positives sneak past every
 * suffix rule below. These are the ones found by testing this stemmer
 * against this repository's own prose — add to it if you find more, don't
 * remove from it speculatively.
 *
 * "hundred" looks like a past participle ("hundr" + "ed") but is a number
 * word. "anything"/"everything"/"nothing"/"something" are the closed set
 * of "-thing" compounds that happen to clear the -ing length floor
 * ("someth" is 6 letters, past the 4-letter no-doubling threshold) while
 * not being a gerund of anything.
 */
const STEM_EXCEPTIONS = new Set([
  "always", "hundred", "anything", "everything", "nothing", "something",
]);

/**
 * Consonants that legitimately double before "-ing"/"-ed" when they follow
 * a short stressed vowel (run -> running, stop -> stopped). Deliberately
 * excludes "s" (process, address, class, access already end in a native
 * "ss" and are guarded separately) and "l" (call, fall, install, pull,
 * kill already end in a native "ll" — this repo's own prose uses
 * "installed"/"calling"/"falling", and undoubling those would wrongly
 * produce "instal"/"cal"/"fal").
 */
const DOUBLING_CONSONANTS = "bdgmnprt";

/** Drop one letter of a final doubled consonant pair, if present. */
function undoubleFinal(s: string): string {
  const n = s.length;
  if (n < 2) return s;
  const last = s[n - 1];
  return last === s[n - 2] && DOUBLING_CONSONANTS.includes(last) ? s.slice(0, -1) : s;
}

/**
 * Fold a stripped "-ing"/"-ed" stem, deciding how far to trust it.
 *
 * If undoubling actually fired (running -> runn -> run), the doubled
 * consonant is strong evidence of a genuine short-vowel gerund/participle,
 * so even a 3-letter result is trusted. If it did not fire, the stem is
 * accepted only at 4+ letters — this is what keeps native words that
 * happen to end in "-ing" (string, spring, during, thing) from being
 * chopped to "str"/"spr"/"dur": those never had a doubled consonant to
 * begin with, so there is no positive evidence they are a verb form at
 * all.
 */
function foldStrippedSuffix(original: string, bare: string): string {
  const undoubled = undoubleFinal(bare);
  const minLen = undoubled === bare ? 4 : 3;
  return undoubled.length >= minLen ? undoubled : original;
}

/**
 * Conservative English suffix folding — NOT Porter stemming. Handles only
 * the three inflections that separate a task-description query from the
 * identifier it should hit: plurals (-s/-es/-ies), gerunds (-ing) and
 * participles (-ed). Explicitly skips nominalizations (-tion/-sion -> t/s
 * was considered and rejected: "session" -> "sess", "nation" -> "nat" are
 * real words already, so folding them collides with unrelated terms far
 * more often than it helps).
 *
 * No dictionary, so silent-e verbs are a known gap: "generated"/"generate"
 * and "included"/"include" do not meet in the middle (stripping "-ed"
 * leaves "generat"/"includ", and there is no safe way to decide whether to
 * add the "e" back without knowing the word). This under-stems rather than
 * over-stems, which is the safer failure mode for a search index.
 */
export function stem(token: string): string {
  if (token.length < STEM_MIN_LEN || STEM_EXCEPTIONS.has(token)) return token;

  // identities -> identity, queries -> query
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  // applied -> apply, tried -> try
  if (token.length > 4 && token.endsWith("ied")) return token.slice(0, -3) + "y";
  // matches -> match, boxes -> box, classes -> class: strip the "es" itself,
  // not just a trailing "s". Deliberately requires the *doubled* "sses" —
  // not a bare "ses" — because a bare "-ses" is ambiguous with an ordinary
  // silent-e plural ("cases" is "case"+"s", not "cas"+"es"; "houses" is
  // "house"+"s"). Those fall through to the plain -s rule below instead,
  // which gets them right.
  if (token.length > 4 && /(?:sses|xes|zes|ches|shes)$/.test(token)) return token.slice(0, -2);
  // scanning -> scan, testing -> test, but not string/spring/during (see
  // foldStrippedSuffix)
  if (token.length > 4 && token.endsWith("ing")) return foldStrippedSuffix(token, token.slice(0, -3));
  // scanned -> scan, detected -> detect, but not seed/need/exceed/agreed
  if (token.length > 4 && token.endsWith("ed") && !token.endsWith("eed")) {
    return foldStrippedSuffix(token, token.slice(0, -2));
  }
  // secrets -> secret, scans -> scan, but not class/process/address (native
  // "ss") or status/focus/analysis (native "us"/"is"/"os" — a false plural
  // fold there is a real word colliding with an unrelated one)
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !/[uio]s$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Tokenize text for BM25 indexing (identifiers) or querying (task
 * descriptions) — the same function is used on both sides so a query term
 * and an identifier collide on the same tokens.
 *
 * Latin-script runs: split on whitespace/punctuation (including `_`/`-`,
 * which sit outside the run pattern), split camelCase/PascalCase, lowercase,
 * drop stopwords and tokens under 2 characters, then fold light English
 * suffixes (see `stem`) so a query like "secret scanning" reaches the
 * identifiers `secrets`/`Scans` without the caller having to guess the
 * exact inflection that appears in the code.
 *
 * CJK runs are indexed as character bigrams instead — Lucene's CJKAnalyzer
 * technique, and the standard answer for Korean/Japanese/Chinese queries
 * without a morphological analyzer: particle changes are absorbed the same
 * way inflection is on the Latin side. Bigrams are never stemmed — the
 * English suffix rules above do not apply to them.
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
      if (t.length >= 2 && !STOPWORDS.has(t)) tokens.push(stem(t));
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
