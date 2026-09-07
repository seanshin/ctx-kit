import { test } from "node:test";
import assert from "node:assert/strict";

import { approxTokens } from "../dist/core/tokens.js";
import { countTokens, exactTokenizerAvailable } from "../dist/adapters/tokenizer.js";

test("approxTokens: pure ASCII text is unchanged from the legacy chars/4 formula", () => {
  const samples = [
    "",
    "hello world",
    "function add(a, b) {\n  return a + b;\n}\n",
    "x".repeat(401), // not a multiple of 4, exercises Math.ceil
  ];
  for (const text of samples) {
    assert.equal(approxTokens(text), Math.ceil(text.length / 4), `mismatch for ${JSON.stringify(text.slice(0, 20))}`);
  }
});

test("approxTokens: CJK text (Korean comments) is counted far above chars/4", () => {
  // A short Korean-commented snippet, representative of the repos this
  // project targets (see docs/WHITEPAPER.ko.md §11).
  const text = "# 이 함수는 재고를 계산한다\ndef 재고_계산(수량, 가격):\n    return 수량 * 가격\n";
  const legacy = Math.ceil(text.length / 4);
  const improved = approxTokens(text);
  assert.ok(
    improved > legacy * 1.5,
    `expected the CJK-aware estimate (${improved}) to clear the old chars/4 estimate (${legacy}) by a wide margin`,
  );
});

test("approxTokens: mixed ASCII+CJK text counts each script at its own rate", () => {
  const ascii = "return value;"; // 14 chars, no CJK
  const cjk = "한글텍스트"; // 5 Hangul syllables
  const mixed = ascii + cjk;
  const expected = Math.ceil(ascii.length / 4) + Math.ceil(5 * 0.95);
  assert.equal(approxTokens(mixed), expected);
  // Every recognized CJK block contributes: Hangul, Hiragana, Katakana,
  // CJK ideographs, and full-width forms.
  const allBlocks = "한글" + "ひらがな" + "カタカナ" + "漢字" + "ＡＢＣ";
  assert.ok(approxTokens(allBlocks) >= Math.ceil([...allBlocks].length * 0.9));
});

test("adapters/tokenizer: countTokens and exactTokenizerAvailable never throw and fall back cleanly", async () => {
  const text = "샘플 텍스트 sample text";
  const available = await exactTokenizerAvailable();
  assert.equal(typeof available, "boolean");

  const counted = await countTokens(text);
  assert.ok(Number.isInteger(counted) && counted > 0);

  if (!available) {
    // With the optional package absent, the adapter must match the
    // dependency-free heuristic exactly — this is the tested default path.
    assert.equal(counted, approxTokens(text));
  } else {
    // With gpt-tokenizer installed, the exact count should be in the same
    // ballpark as the heuristic (sanity bound, not equality).
    const approx = approxTokens(text);
    assert.ok(counted > 0 && counted < approx * 3);
  }

  assert.equal(await countTokens(""), approxTokens(""));
});
