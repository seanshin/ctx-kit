/**
 * Query-directed ranking — `pack --about "<task>"` (plan §4.4, stream B).
 *
 * `makeQueryScorer` builds a `Scorer` (see `core/repomap.ts`'s seam) for one
 * free-text query. `core/pack.ts` wires it in only when `opts.about` is set;
 * with no query, ranking is unchanged (plan §4.4: "no regression").
 */
import type { CtxConfig } from "../core/config.js";
import { readText } from "../core/fs.js";
import type { RankedFile, Scorer } from "../core/repomap.js";
import { bm25, tokenize, type Bm25Doc } from "../core/retrieve.js";

/** path 3 · symbols 2 · body 1 (plan §4.4). */
const FIELD_WEIGHTS = { path: 3, symbols: 2, body: 1 } as const;

/**
 * Field-weighted BM25 (a simplified BM25F): each field gets its own BM25
 * pass — its own average length, its own `b` — and the three are combined
 * by a fixed weight. This must NOT be approximated by concatenating the
 * fields into one document and running BM25 once: repeating the path into
 * a long body also inflates that document's length, so length
 * normalization buries the path/symbol signal in files with large bodies
 * (plan §4.4 rationale for the two BM25 revisions).
 */
export function scoreQuery(files: RankedFile[], config: CtxConfig, query: string, contents?: ReadonlyMap<string, string>): Map<string, number> {
  const queryTerms = tokenize(query);
  const raw = new Map<string, number>();
  if (queryTerms.length === 0) return raw;

  const pathDocs: Bm25Doc[] = [];
  const symbolDocs: Bm25Doc[] = [];
  const bodyDocs: Bm25Doc[] = [];
  for (const f of files) {
    pathDocs.push({ id: f.rel, tokens: tokenize(f.rel) });
    symbolDocs.push({ id: f.rel, tokens: tokenize(f.symbols.map((s) => s.name).join(" ")) });
    // Symbol extraction failed or the language is unsupported: score on
    // path/body only rather than throwing away the file (plan §6-C).
    // Use the contents the ranker already read: re-reading every file from
    // disk here put `pack --about` over the §6-B budget on a 300-file repo.
    bodyDocs.push({
      id: f.rel,
      tokens: tokenize(contents?.get(f.rel) ?? readText(config.root, f.rel) ?? ""),
    });
  }

  // path/symbols have low length variance (a filename, a name list), so
  // length normalization is milder (b=0.5) than for free-form body text
  // (b=0.75) — plan §4.4.
  const pathScores = bm25(pathDocs, queryTerms, { b: 0.5 });
  const symbolScores = bm25(symbolDocs, queryTerms, { b: 0.5 });
  const bodyScores = bm25(bodyDocs, queryTerms, { b: 0.75 });

  for (const f of files) {
    raw.set(
      f.rel,
      FIELD_WEIGHTS.path * (pathScores.get(f.rel) ?? 0) +
        FIELD_WEIGHTS.symbols * (symbolScores.get(f.rel) ?? 0) +
        FIELD_WEIGHTS.body * (bodyScores.get(f.rel) ?? 0),
    );
  }
  return raw;
}

/**
 * Build a `Scorer` for one query. Contributions are max-normalized to
 * 0..1 (so the top-matching file always contributes exactly `query_weight`,
 * regardless of absolute BM25 magnitude) and multiplied by
 * `config.ranking.query_weight` (default 2): `score(F) = ref(F) + W ·
 * normalize(q(F))` (plan §4.4).
 */
export function makeQueryScorer(query: string): Scorer {
  return (files, config, contents) => {
    const raw = scoreQuery(files, config, query, contents);
    const max = Math.max(0, ...raw.values());
    const out = new Map<string, number>();
    if (max <= 0) return out;
    const weight = config.ranking.query_weight;
    for (const [rel, v] of raw) out.set(rel, (v / max) * weight);
    return out;
  };
}
