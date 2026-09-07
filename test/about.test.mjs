/**
 * Query-directed packs — `pack --about "<task>"` (stream B, plan §4.4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/core/config.js";
import { rankFiles } from "../dist/core/repomap.js";
import { buildPack, explainPack } from "../dist/core/pack.js";
import { stem, tokenize } from "../dist/core/retrieve.js";
import { makeQueryScorer } from "../dist/scorers/query.js";

/** Scaffold a small polyglot repo and return its root + config. */
function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-about-test-"));
  const defaults = {
    "AGENTS.md": "# AGENTS.md\n\n## Commands\n\n- Test: `pytest`\n",
    "src/app.py":
      "from core import compute_price\n\nclass App:\n    def run(self):\n        return compute_price(1)\n",
    "src/core.py": "def compute_price(x):\n    return x * 1.1\n",
    "tests/test_app.py":
      "from app import App\nfrom core import compute_price\n\ndef test_run():\n    assert App\n\ndef test_price():\n    assert compute_price(1)\n",
  };
  for (const [rel, content] of Object.entries({ ...defaults, ...files })) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, config: loadConfig(root) };
}

test("about: no query ranks identically to plain rankFiles (regression)", () => {
  const { config } = makeRepo({
    "src/extra.py": "def helper_thing():\n    return 1\n",
  });
  // Same call the pre-stream-B code made: rankFiles with no scorers.
  const plainOrder = rankFiles(config).map((e) => e.rel);

  for (const opts of [{ profile: "light" }, { profile: "light", about: undefined }]) {
    const pack = buildPack(config, opts);
    const targetOrder = [...pack.content.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(
      targetOrder,
      plainOrder.filter((r) => targetOrder.includes(r)),
      "target-files order must match the query-less reference ranking",
    );
  }

  // The scorer array taken by targetFiles() is empty with no `about`, so a
  // second call is byte-identical to the first — no hidden nondeterminism.
  const a = buildPack(config, { profile: "light" });
  const b = buildPack(config, { profile: "light" });
  assert.equal(a.content.replace(/generated=[^\s]+/g, ""), b.content.replace(/generated=[^\s]+/g, ""));
});

test("about: path/symbol matches outrank a body-only match (field weighting)", () => {
  const { config } = makeRepo({
    // Query term only in the path and a symbol name; body is unrelated.
    "src/widget.py": "def build():\n    return unrelated_stuff()\n",
    // Query term repeated many times in the body only; path/symbols carry
    // no trace of it. BM25 saturates term frequency, so no amount of
    // repetition should let a body-only match out-rank a path/symbol hit,
    // given path/symbols carry weight 3/2 against body's 1 (plan §4.4).
    "src/other.py": `def unrelated():\n${"    # widget widget widget widget\n".repeat(30)}    return 1\n`,
  });
  const files = rankFiles(config, { files: ["src/widget.py", "src/other.py"] });
  const contribution = makeQueryScorer("widget")(files, config);
  assert.ok(contribution.get("src/widget.py") > 0, "path match must score above zero");
  assert.ok(
    contribution.get("src/widget.py") > (contribution.get("src/other.py") ?? 0),
    `path/symbol match (${contribution.get("src/widget.py")}) should outrank a body-only match (${contribution.get("src/other.py")})`,
  );
});

test("about: CJK bigrams survive a Korean particle change", () => {
  // "할인율을" (discount rate + object particle 을) vs the query "할인율"
  // (discount rate, no particle) — a plain substring/whole-word match would
  // miss this; bigram overlap (할인, 인율) must not.
  const withParticle = tokenize("할인율을 적용한다");
  const withoutParticle = tokenize("할인율");
  const overlap = withoutParticle.filter((t) => withParticle.includes(t));
  assert.ok(overlap.length > 0, "bigrams must overlap across a particle change");

  const { config } = makeRepo({
    "src/discount.py": "def apply():\n    # 할인율을 적용한다\n    return 1\n",
    "src/unrelated.py": "def other():\n    return 2\n",
  });
  const files = rankFiles(config, { files: ["src/discount.py", "src/unrelated.py"] });
  const contribution = makeQueryScorer("할인율")(files, config);
  assert.ok(
    (contribution.get("src/discount.py") ?? 0) > (contribution.get("src/unrelated.py") ?? 0),
    "a query without the particle must still match the file that has it",
  );
});

test("stem: plurals, gerunds and participles fold onto the same token as their identifier", () => {
  // The motivating cases from the README/plan gap: a task-description query
  // naturally lands on a different inflection than the identifier it should
  // hit.
  assert.equal(stem("secrets"), stem("secret"));
  assert.equal(stem("scanning"), stem("scans")); // "Scans" lowercased
  assert.equal(stem("ranking"), stem("ranks"));
  assert.equal(stem("queries"), stem("query"));
  assert.equal(stem("detected"), stem("detecting"));
});

test("stem: does not over-fold short tokens, native '-ing'/'-ss' words, or ambiguous silent-e plurals", () => {
  // Guard: tokens under ~4 characters are never touched.
  assert.equal(stem("gas"), "gas");
  assert.equal(stem("is"), "is");
  // Native "-ing" words with no doubled consonant to justify a fold —
  // stripping "ing" would produce nonsense ("str", "dur") rather than a
  // real root.
  assert.equal(stem("string"), "string");
  assert.equal(stem("during"), "during");
  // "-thing" compounds clear the length floor but are not gerunds of
  // anything; a native double-consonant word ("install"/"class") must not
  // be undoubled into a different word.
  assert.equal(stem("something"), "something");
  assert.equal(stem("install"), "install");
  assert.equal(stem("class"), "class");
  // A bare "-ses" is ambiguous with an ordinary silent-e plural: "cases" is
  // "case" + "s", not "cas" + "es".
  assert.equal(stem("cases"), "case");
  // A real double-s plural still folds correctly.
  assert.equal(stem("classes"), "class");
});

test("about: an inflected query reaches a file only its identifier's other inflection names", () => {
  const { config } = makeRepo({
    // The path/symbol carries "secrets" (plural); the query below uses
    // "scanning" (gerund of "scan") and no other unstemmed word in this
    // file. Without folding, neither term would match.
    "src/checks/secrets.py": "def scans_for_secrets():\n    return True\n",
    "src/unrelated.py": "def helper():\n    return 1\n",
  });
  const files = rankFiles(config, { files: ["src/checks/secrets.py", "src/unrelated.py"] });
  const contribution = makeQueryScorer("secret scanning")(files, config);
  assert.ok(
    (contribution.get("src/checks/secrets.py") ?? 0) > (contribution.get("src/unrelated.py") ?? 0),
    "an inflected query must still reach the file whose identifiers use a different inflection",
  );
});

test("about: --explain reports a ranked, budget-aware breakdown", () => {
  const { config } = makeRepo({
    "src/widget.py": "def build_widget():\n    return 1\n",
  });
  const rows = explainPack(config, { profile: "light", about: "widget" });

  assert.ok(rows.length > 0 && rows.length <= 20, "at most 20 rows");
  for (const r of rows) {
    for (const key of ["rel", "referenceScore", "queryScore", "demotion", "finalScore", "included"]) {
      assert.ok(key in r, `row missing ${key}`);
    }
    // The ranker demotes test paths after every signal, so the breakdown has
    // to show that factor for the arithmetic to hold.
    assert.ok(
      Math.abs(r.finalScore - (r.referenceScore + r.queryScore) * r.demotion) < 1e-9,
      `final must equal (reference + query) * demotion for ${r.rel}`,
    );
  }
  // Sorted descending by final score.
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].finalScore >= rows[i].finalScore, "rows must be sorted by final score, descending");
  }
  // The query match should be present and marked included (light profile's
  // budget easily fits this tiny repo).
  const widget = rows.find((r) => r.rel === "src/widget.py");
  assert.ok(widget, "queried file must appear in the breakdown");
  assert.equal(widget.included, true);
  assert.ok(widget.queryScore > 0, "a matched file must carry a positive query contribution");

  // With no `about`, the query column is uniformly zero and final ==
  // reference — the same no-regression guarantee, visible in the table.
  const noQuery = explainPack(config, { profile: "light" });
  assert.ok(
    noQuery.every(
      (r) => r.queryScore === 0 && Math.abs(r.finalScore - r.referenceScore * r.demotion) < 1e-9,
    ),
  );
});
