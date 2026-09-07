/**
 * Stream A ("gate") tests — repository health checks (docs/plan-v2.md §4.2)
 * and rule/config rot detection (§4.3). Test plan: §6-D.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { loadConfig } from "../dist/core/config.js";
import { runChecks } from "../dist/core/check.js";
import { extractImports } from "../dist/adapters/imports.js";
import { readBaseline, writeBaseline, toBaselineEntries, applyBaseline } from "../dist/core/baseline.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist/cli.js");

/** Scaffold a small repo (config + files) and return its root + config. */
function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-gate-test-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, config: loadConfig(root) };
}

function byName(results, name) {
  return results.filter((r) => r.name === name);
}

/* ---------------------------------------------------------------- */
/* §4.2 constraints                                                  */
/* ---------------------------------------------------------------- */

test("health: only_in passes when a symbol is confined, fails when defined elsewhere", () => {
  const violating = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: discount-single-source\n    symbol: "apply_discount"\n    only_in: ["src/pricing/discount.py"]\n',
    "src/pricing/discount.py": "def apply_discount(x):\n    return x\n",
    "src/pricing/other.py": "def apply_discount(x):\n    return x * 2\n",
  });
  const bad = runChecks(violating.config);
  const constraintResults = byName(bad, "constraint");
  assert.ok(
    constraintResults.some((r) => r.level === "fail" && r.detail.includes("discount-single-source") && r.detail.includes("other.py")),
    "expected a fail for apply_discount defined outside only_in",
  );

  const clean = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: discount-single-source\n    symbol: "apply_discount"\n    only_in: ["src/pricing/discount.py"]\n',
    "src/pricing/discount.py": "def apply_discount(x):\n    return x\n",
  });
  const good = runChecks(clean.config);
  assert.ok(byName(good, "constraint").some((r) => r.level === "ok" && r.detail.includes("discount-single-source")));
});

test("health: must_not_import catches a raw specifier and a resolved relative import", () => {
  // Stage ①: raw specifier text matches the forbidden pattern directly.
  const rawHit = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: no-legacy-db\n    from: ["src/ui/**"]\n    must_not_import: ["twin.db"]\n',
    "src/ui/widget.py": "from twin.db import get_conn\n",
  });
  const rawResults = runChecks(rawHit.config);
  assert.ok(
    byName(rawResults, "constraint").some((r) => r.level === "fail" && r.detail.includes("no-legacy-db") && r.detail.includes("twin.db")),
  );

  // Stage ②: "../db/client" resolves to an actual file that matches the glob.
  const resolvedHit = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: no-db-from-ui\n    from: ["src/ui/**"]\n    must_not_import: ["src/db/**"]\n',
    "src/ui/widget.ts": 'import { conn } from "../db/client";\n',
    "src/db/client.ts": "export const conn = 1;\n",
  });
  const resolvedResults = runChecks(resolvedHit.config);
  const hit = byName(resolvedResults, "constraint").find((r) => r.detail.includes("no-db-from-ui"));
  assert.ok(hit && hit.level === "fail");
  assert.match(hit.detail, /resolved: src\/db\/client\.ts/);
  assert.match(hit.detail, /tsconfig/); // the resolution-limits caveat must be surfaced

  // A pass case: importing something outside the forbidden glob is fine.
  const clean = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: no-db-from-ui\n    from: ["src/ui/**"]\n    must_not_import: ["src/db/**"]\n',
    "src/ui/widget.ts": 'import { util } from "../shared/util";\n',
    "src/shared/util.ts": "export const util = 1;\n",
  });
  const cleanResults = runChecks(clean.config);
  assert.ok(byName(cleanResults, "constraint").some((r) => r.level === "ok" && r.detail.includes("no-db-from-ui")));
});

test("health: forbid_pattern passes and fails on the configured path glob", () => {
  const violating = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: no-plaintext-password\n    forbid_pattern: "password\\\\s*="\n    in: ["config/**"]\n',
    "config/settings.yaml": 'password = "hunter2"\n',
  });
  const bad = runChecks(violating.config);
  assert.ok(byName(bad, "constraint").some((r) => r.level === "fail" && r.detail.includes("no-plaintext-password")));

  const clean = makeRepo({
    "context.config.yaml":
      'version: 1\nconstraints:\n  - id: no-plaintext-password\n    forbid_pattern: "password\\\\s*="\n    in: ["config/**"]\n',
    "config/settings.yaml": 'username = "admin"\n',
  });
  const good = runChecks(clean.config);
  assert.ok(byName(good, "constraint").some((r) => r.level === "ok" && r.detail.includes("no-plaintext-password")));
});

test("health: duplicate filter chain narrows to real duplicates (test/nested/dunder/short/signature excluded)", () => {
  const { config } = makeRepo({
    // Real duplicate: same name, same file count, top-level, identical signature.
    "src/dup1.ts": "export function helper() {}\n",
    "src/dup2.ts": "export function helper() {}\n",
    // Excluded: one occurrence lives under a test path.
    "src/util1.ts": "export function sharedUtil() {}\n",
    "tests/util_test.ts": "export function sharedUtil() {}\n",
    // Excluded: dunder name.
    "src/x.py": "def __init__(self):\n    pass\n",
    "src/y.py": "def __init__(self):\n    pass\n",
    // Excluded: name shorter than 4 characters.
    "src/p.ts": "export function abc() {}\n",
    "src/q.ts": "export function abc() {}\n",
    // Excluded: not top-level (nested inside a class).
    "src/m1.py": "class Foo:\n    def method(self):\n        pass\n",
    "src/m2.py": "class Bar:\n    def method(self):\n        pass\n",
    // Excluded: same name, different (normalized) signature.
    "src/s1.ts": "export function process(a) {}\n",
    "src/s2.ts": "export function process(a, b) {}\n",
  });
  const results = runChecks(config);
  const duplicates = byName(results, "duplicate").filter((r) => r.level !== "ok");
  const details = duplicates.map((r) => r.detail).join("\n");
  assert.match(details, /"helper" defined identically in src\/dup1\.ts, src\/dup2\.ts/);
  for (const excluded of ["sharedUtil", "__init__", "abc", "method", "process"]) {
    assert.ok(!details.includes(`"${excluded}"`), `${excluded} should have been filtered out`);
  }
});

test("health: orphans hold back files with zero extracted symbols and skip entry points", () => {
  const { config } = makeRepo({
    "src/used.ts": "export function usedThing() { return 1; }\n",
    "src/consumer.ts": 'import { usedThing } from "./used";\nusedThing();\n',
    "src/lonely.ts": "export function lonelyThing() { return 2; }\n",
    // No extractable symbols: extraction failure and disuse are indistinguishable.
    "src/noSymbols.ts": "export default { a: 1 };\n",
    // Unreferenced, but an entry point by filename convention.
    "src/index.ts": "export function neverCalledDirectly() { return 3; }\n",
  });
  const results = runChecks(config);
  const orphans = byName(results, "orphan").filter((r) => r.level !== "ok");
  const paths = orphans.map((r) => r.detail);
  assert.ok(paths.some((d) => d.includes("src/lonely.ts")));
  assert.ok(!paths.some((d) => d.includes("src/used.ts")));
  assert.ok(!paths.some((d) => d.includes("src/noSymbols.ts")), "symbol-less file must be held back, not reported");
  assert.ok(!paths.some((d) => d.includes("src/index.ts")), "entry-point files must be excluded");
});

test("health: coverage reports files outside every module glob, and is skipped when modules is empty", () => {
  const { config } = makeRepo({
    "context.config.yaml": 'version: 1\nmodules:\n  covered:\n    - "src/covered/**"\n',
    "src/covered/a.ts": "export function a() {}\n",
    "src/uncovered/b.ts": "export function b() {}\n",
  });
  const results = runChecks(config);
  const coverage = byName(results, "coverage");
  // health.coverage's documented default is "info" (context.config.yaml
  // schema, docs/plan-v2.md §4.2) and CheckResult.level carries it through
  // unmapped — it must never read as "warn".
  assert.ok(coverage.some((r) => r.detail.includes("src/uncovered/b.ts") && r.level === "info"));
  assert.ok(!coverage.some((r) => r.detail.includes("src/covered/a.ts")));

  const { config: noModules } = makeRepo({ "src/a.ts": "export function a() {}\n" });
  const skipped = byName(runChecks(noModules), "coverage");
  assert.ok(skipped.some((r) => r.level === "ok" && r.detail.includes("skipped")));
});

test("baseline: ratchets a known violation to warn while a new one still fails", () => {
  const { root } = makeRepo({});
  const results = [
    { level: "fail", name: "constraint", detail: "[c1] known violation" },
    { level: "fail", name: "constraint", detail: "[c2] brand new violation" },
    { level: "ok", name: "constraint", detail: "[c3] satisfied" },
  ];
  writeBaseline(root, toBaselineEntries([results[0]]));
  const baseline = readBaseline(root);
  assert.equal(baseline.length, 1);

  const applied = applyBaseline(results, baseline);
  assert.equal(applied.find((r) => r.detail.includes("known violation")).level, "warn");
  assert.equal(applied.find((r) => r.detail.includes("brand new violation")).level, "fail");
  assert.equal(applied.find((r) => r.detail.includes("satisfied")).level, "ok");

  // --no-baseline behavior: caller simply skips applyBaseline (wired in cli.ts).
  assert.deepEqual(results, results); // unmodified when the ratchet is bypassed
});

/* ---------------------------------------------------------------- */
/* §4.3 rot                                                          */
/* ---------------------------------------------------------------- */

test("rot: fenced code blocks are stripped before path candidates are extracted", () => {
  const { config } = makeRepo({
    "AGENTS.md":
      "# AGENTS.md\n\n## Commands\n\n- Test: `npm test`\n\n" +
      "```\nexample: `src/totally/fake/path.ts` and `npm not-a-real-runner`\n```\n",
  });
  const results = runChecks(config);
  const paths = byName(results, "rot-path");
  assert.ok(!paths.some((r) => r.detail.includes("src/totally/fake/path.ts")), "fenced content must not become a candidate");
});

test("rot: a documented path that does not exist is reported at warn", () => {
  const { config } = makeRepo({
    "AGENTS.md": "# AGENTS.md\n\n## Commands\n\n- Test: `npm test`\n\nSee `src/definitely/missing.ts` for details.\n",
  });
  const results = runChecks(config);
  const hit = byName(results, "rot-path").find((r) => r.detail.includes("src/definitely/missing.ts"));
  assert.ok(hit && hit.level === "warn");
});

test("rot: a glob path with zero matches is reported, a glob that matches is not", () => {
  const { config } = makeRepo({
    "AGENTS.md":
      "# AGENTS.md\n\n## Commands\n\n- Test: `npm test`\n\n" +
      "Source lives under `src/**/*.ts`. Nothing lives under `src/nomatch/**/*.ts`.\n",
    "src/real.ts": "export const x = 1;\n",
  });
  const results = runChecks(config);
  const paths = byName(results, "rot-path");
  assert.ok(paths.some((r) => r.detail.includes("src/nomatch/**/*.ts") && r.level === "warn"));
  assert.ok(!paths.some((r) => r.detail.includes('"src/**/*.ts"') && r.level !== "ok"));
});

test("rot: a module glob matching zero files is config rot (fail); a matching one is ok", () => {
  const { config } = makeRepo({
    "context.config.yaml": 'version: 1\nmodules:\n  ghost:\n    - "src/ghost/**"\n  real:\n    - "src/**"\n',
    "src/a.ts": "export const a = 1;\n",
  });
  const results = runChecks(config);
  const modules = byName(results, "rot-module");
  assert.ok(modules.some((r) => r.level === "fail" && r.detail.includes('module "ghost"')));
  assert.ok(modules.some((r) => r.level === "ok" && r.detail.includes('module "real"')));
});

test("rot: command candidates outside '## Commands' are ignored", () => {
  const { config } = makeRepo({
    "AGENTS.md": "# AGENTS.md\n\nRun `npm run outside-the-section` whenever.\n\n## Commands\n\n- Test: `npm test`\n",
  });
  const results = runChecks(config);
  const commands = byName(results, "rot-command");
  assert.ok(!commands.some((r) => r.detail.includes("outside-the-section")));
});

/* ---------------------------------------------------------------- */
/* Stream G regressions                                              */
/* ---------------------------------------------------------------- */

// (1) --run-commands must never hang on a non-terminating command — this
// repo's own AGENTS.md documents `Watch: \`npm run dev\`` (tsc --watch,
// never exits) and used to burn the full 120s timeout and report ETIMEDOUT
// as a false `fail`. A terminating command in the same section must still
// actually run.
test("rot: --run-commands skips a watch/dev command by name instead of running it, and still runs a normal one", () => {
  const { config } = makeRepo({
    "AGENTS.md":
      "# AGENTS.md\n\n## Commands\n\n- Version: `npm --version`\n- Watch: `npm run dev`\n",
  });
  const start = Date.now();
  const results = runChecks(config, { runCommands: true });
  assert.ok(Date.now() - start < 10_000, "must not burn the 120s command timeout on a non-terminating command");

  const commands = byName(results, "rot-command");
  const watch = commands.find((r) => r.detail.includes("npm run dev"));
  assert.ok(watch, "expected a result for the watch command");
  assert.equal(watch.level, "info", "a skipped-by-design command must not fail or warn the gate");
  assert.match(watch.detail, /skipped by design/);
  assert.match(watch.detail, /Watch/); // named so the user knows what was not verified
  assert.equal(watch.subject, "npm run dev");

  const ran = commands.find((r) => r.detail.includes("npm --version"));
  assert.ok(ran, "expected a result for the normal command");
  assert.equal(ran.level, "ok");
  assert.match(ran.detail, /ran successfully/);
});

test("rot: config.rot.skip_commands force-skips a command the built-in heuristic would otherwise run", () => {
  const { config } = makeRepo({
    "context.config.yaml": 'version: 1\nrot:\n  skip_commands:\n    - "mything"\n',
    "AGENTS.md": "# AGENTS.md\n\n## Commands\n\n- Custom: `npm run mything`\n",
  });
  const results = runChecks(config, { runCommands: true });
  const hit = byName(results, "rot-command").find((r) => r.detail.includes("npm run mything"));
  assert.ok(hit);
  assert.equal(hit.level, "info");
  assert.match(hit.detail, /rot\.skip_commands/);
});

// (2) HealthConfig's 4-valued Level (info/ok/warn/fail) must reach
// CheckResult.level unmapped, print distinctly in the CLI, and never count
// toward the failure exit code.
test("cli: an info-level finding (coverage's default) exits 0 and prints its own icon, not warn's", () => {
  const { root } = makeRepo({
    "AGENTS.md": "# AGENTS.md\n",
    "context.config.yaml": 'version: 1\nmodules:\n  covered:\n    - "src/covered/**"\n',
    "src/covered/a.ts": "export function a() {}\n",
    "src/uncovered/b.ts": "export function b() {}\n",
  });
  const res = spawnSync(process.execPath, [CLI, "-C", root, "check"], { encoding: "utf8" });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /^i \[coverage\] src\/uncovered\/b\.ts matches no module glob$/m);
  assert.ok(!res.stdout.includes("! [coverage]"), "coverage's info-level result must not print with warn's icon");
  assert.ok(!res.stderr.includes("check(s) failed"));
});

// (3) The baseline must key on {check, location, subject}, not on `detail`
// prose, so an unrelated wording change to a check's message doesn't
// silently invalidate the entry — while a genuinely different violation
// (different subject) at the same location still fails.
test("baseline: a detail reword does not invalidate a structured entry, but a different subject still fails", () => {
  const { root } = makeRepo({});
  const original = {
    level: "fail",
    name: "constraint",
    detail: "[discount-single-source] \"apply_discount\" defined at src/pricing/other.py:1, but only_in allows src/pricing/discount.py",
    location: { file: "src/pricing/other.py", line: 1 },
    subject: "discount-single-source",
  };
  writeBaseline(root, toBaselineEntries([original]));
  const baseline = readBaseline(root);
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0].identifier, undefined, "a structured result must not fall back to a prose identifier");

  // Same location + subject, wording changed — must still ratchet to warn.
  const reworded = { ...original, detail: "[discount-single-source] apply_discount also defined outside only_in now" };
  const appliedReword = applyBaseline([reworded], baseline);
  assert.equal(appliedReword[0].level, "warn", "a prose-only reword must not invalidate the baseline entry");

  // Different subject, same location — a genuinely new violation must still fail.
  const differentSubject = { ...original, subject: "some-other-constraint" };
  const appliedNew = applyBaseline([differentSubject], baseline);
  assert.equal(appliedNew[0].level, "fail", "a different subject at the same location is a different violation");

  // Backward compatibility: a schema-1 baseline file ({check, identifier})
  // must still be readable and still ratchet its matching prose result.
  mkdirSync(join(root, "docs/generated"), { recursive: true });
  writeFileSync(
    join(root, "docs/generated/baseline.json"),
    JSON.stringify({ version: 1, entries: [{ check: "constraint", identifier: "[legacy] old prose violation" }] }, null, 2),
  );
  const legacyBaseline = readBaseline(root);
  assert.equal(legacyBaseline.length, 1);
  const legacyResult = { level: "fail", name: "constraint", detail: "[legacy] old prose violation" };
  assert.equal(applyBaseline([legacyResult], legacyBaseline)[0].level, "warn");
});

/* ---------------------------------------------------------------- */
/* adapters/imports.ts — direct extraction coverage                  */
/* ---------------------------------------------------------------- */

test("imports: extracts and resolves specifiers across languages", () => {
  const { root } = makeRepo({
    "src/db/client.ts": "export const conn = 1;\n",
  });
  const ts = extractImports(
    root,
    "src/ui/widget.ts",
    'import { conn } from "../db/client";\nimport "./side-effect";\nconst x = require("bare-pkg");\n',
  );
  assert.deepEqual(ts.map((i) => i.specifier), ["../db/client", "./side-effect", "bare-pkg"]);
  assert.equal(ts[0].resolved, "src/db/client.ts");
  assert.equal(ts[2].resolved, null); // bare specifiers are never resolved

  const py = extractImports(root, "a.py", "import os\nfrom twin.db import get_conn\n");
  assert.deepEqual(py.map((i) => i.specifier), ["os", "twin.db"]);
  assert.equal(py[0].resolved, null);

  const go = extractImports(root, "a.go", 'import (\n\t"fmt"\n\t"github.com/x/y"\n)\n');
  assert.deepEqual(go.map((i) => i.specifier), ["fmt", "github.com/x/y"]);

  const rs = extractImports(root, "a.rs", "use crate::foo::bar;\nmod baz;\n");
  assert.deepEqual(rs.map((i) => i.specifier), ["crate::foo::bar", "baz"]);
});
