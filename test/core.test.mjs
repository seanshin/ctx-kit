import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, DEFAULT_PROFILES } from "../dist/core/config.js";
import { walkFiles } from "../dist/core/fs.js";
import { extractSymbols } from "../dist/adapters/symbols.js";
import { buildRepoMap, rankFiles } from "../dist/core/repomap.js";
import { buildPack } from "../dist/core/pack.js";
import { syncRules, checkSync } from "../dist/core/sync.js";
import { runChecks } from "../dist/core/check.js";
import { CHECKS } from "../dist/checks/index.js";
import { select } from "../dist/core/select.js";
import { detectProject } from "../dist/core/detect.js";
import { getContext } from "../dist/core/get.js";

/** Scaffold a small polyglot repo and return its root + config. */
function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-test-"));
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

test("config: defaults apply when no config file exists", () => {
  const { config } = makeRepo();
  assert.deepEqual(Object.keys(config.profiles), Object.keys(DEFAULT_PROFILES));
  assert.equal(config.version, 1);
});

test("config: rejects unknown schema version", () => {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-test-"));
  writeFileSync(join(root, "context.config.yaml"), "version: 99\n");
  assert.throws(() => loadConfig(root), /unsupported schema version/);
});

test("walkFiles: skips dot dirs, node_modules and honors excludes", () => {
  const { root } = makeRepo({
    ".venv/lib/junk.py": "x=1",
    "node_modules/pkg/i.js": "x",
    "gen/out.py": "x=1",
  });
  const files = walkFiles(root, { exclude: ["gen/**"] });
  assert.ok(files.includes("src/app.py"));
  assert.ok(!files.some((f) => f.includes(".venv") || f.includes("node_modules") || f.startsWith("gen/")));
});

test("symbols: extracts python and typescript definitions", () => {
  const py = extractSymbols("a.py", "class Foo:\n    def bar(self, x):\n        pass\n");
  assert.deepEqual(py.map((s) => s.name), ["Foo", "bar"]);
  const ts = extractSymbols(
    "a.ts",
    "export class Svc {}\nexport function go(a: number) {}\nexport const fn = (x) => x\n",
  );
  assert.deepEqual(ts.map((s) => s.name), ["Svc", "go", "fn"]);

  // Type annotations must not hide a definition: typed exported consts are
  // ubiquitous in TypeScript and carry cross-file references.
  const typed = extractSymbols(
    "b.ts",
    "export const handler: Handler = (x) => x\nexport const VERSION: string = read()\nconst local = 1\n",
  );
  assert.deepEqual(typed.map((s) => s.name), ["handler", "VERSION"]);
  assert.equal(typed[0].kind, "function");
  assert.equal(typed[1].kind, "const");
});

test("repomap: referenced files outrank, test files are demoted", () => {
  const { config } = makeRepo();
  const ranked = rankFiles(config).map((e) => e.rel);
  assert.equal(ranked[0], "src/core.py"); // compute_price referenced twice
  assert.equal(ranked.at(-1), "tests/test_app.py");
  const map = buildRepoMap(config, { budget: 4000 });
  assert.match(map, /ctxkit:v1 repomap/);
  assert.match(map, /compute_price/);
});

test("pack: honors section order, module filter and budget", () => {
  const { root } = makeRepo({
    "context.config.yaml": 'version: 1\nmodules:\n  core:\n    - "src/**"\n',
  });
  const config = loadConfig(root);
  const pack = buildPack(config, { profile: "light", module: "core" });
  assert.match(pack.content, /ctxkit:v1 pack profile=light module=core/);
  assert.match(pack.content, /compute_price/);
  // Repomap section legitimately lists the whole repo; the module filter
  // applies to the Target Files section.
  const targetSection = pack.content.split("## Target Files")[1] ?? "";
  assert.ok(!targetSection.includes("### tests/"), "module filter leaked test files");
  assert.throws(() => buildPack(config, { profile: "nope" }), /unknown profile/);
  const tiny = buildPack(
    { ...config, profiles: { ...config.profiles, light: { inject: ["repomap", "target-files"], budget: 300 } } },
    { profile: "light" },
  );
  assert.ok(tiny.tokens <= 400, `tiny pack exceeded budget: ${tiny.tokens}`);
});

test("pack: a module pack embeds a module-scoped map, not the repo-wide one", () => {
  const { root } = makeRepo({
    "context.config.yaml": 'version: 1\nmodules:\n  core:\n    - "src/**"\n',
    "web/ui.py": "def render_widget():\n    return 1\n",
    "web/page.py": "from ui import render_widget\n\ndef page():\n    return render_widget()\n",
  });
  const config = loadConfig(root);
  const pack = buildPack(config, { profile: "light", module: "core" });
  const map = pack.content.split("## Repository Map")[1].split("## Target Files")[0];
  const [outline, elsewhere = ""] = map.split("### Elsewhere in the repository");

  assert.match(outline, /scope=core/);
  assert.match(outline, /## src\/core\.py/);
  assert.ok(!outline.includes("## web/"), "symbol outlines leaked from another module");
  // Orientation index: paths only, so the model still knows what exists.
  assert.match(elsewhere, /web\/ui\.py/);
  assert.ok(!/^- L\d+ /m.test(elsewhere), "the orientation index must stay paths-only");
});

test("pack: an oversized file is skipped, not treated as a stop sign", () => {
  const { root } = makeRepo({
    // Ranked first (referenced), then a huge file, then a small one.
    "src/huge.py": `from core import compute_price\n${"# padding\n".repeat(4000)}`,
    "src/small.py": "from core import compute_price\n\ndef tiny():\n    return compute_price(2)\n",
  });
  const config = loadConfig(root);
  const profiles = {
    ...config.profiles,
    light: { inject: ["target-files"], budget: 3000 },
  };
  const pack = buildPack({ ...config, profiles }, { profile: "light" });
  assert.ok(!pack.content.includes("### src/huge.py"), "huge file should not fit");
  assert.match(pack.content, /### src\/small\.py/, "smaller file after it must still be included");
  assert.match(pack.content, /1 file\(s\) omitted/);
  assert.ok(pack.tokens <= 3000, `budget exceeded: ${pack.tokens}`);
});

test("sync: writes generated copies, protects foreign files, detects staleness", () => {
  const { root, config } = makeRepo();
  assert.equal(syncRules(config)[0].action, "written");
  assert.match(readFileSync(join(root, "CLAUDE.md"), "utf8"), /generated by ctxkit sync/);
  writeFileSync(join(root, "AGENTS.md"), "# changed\n");
  assert.equal(checkSync(config)[0].status, "stale");
  writeFileSync(join(root, "CLAUDE.md"), "handwritten rules\n");
  assert.equal(syncRules(config)[0].action, "skipped-foreign");
  assert.equal(syncRules(config, { force: true })[0].action, "written");
});

test("check: fails on oversized rules and on secrets in generated output", () => {
  const { root } = makeRepo({
    "docs/generated/leak.md": 'api_key = "sk_live_0123456789abcdef"\n',
    "AGENTS.md": "# AGENTS.md\n".repeat(200),
  });
  const results = runChecks(loadConfig(root));
  assert.ok(results.some((r) => r.level === "fail" && r.name === "agents-length"));
  assert.ok(results.some((r) => r.level === "fail" && r.name === "secrets" && r.detail.includes("leak.md")));
});

test("detect: finds commands and module boundaries", () => {
  const { root } = makeRepo({
    "pytest.ini": "[pytest]\n",
    "web/package.json": '{"scripts":{"test":"vitest run"}}',
    "web/a.ts": "export function a() {}",
    "web/b.ts": "export function b() {}",
    "web/c.ts": "export function c() {}",
  });
  const d = detectProject(loadConfig(root));
  assert.ok(d.commands.some((c) => c.includes("pytest")));
  assert.ok(d.commands.some((c) => c.includes("cd web && npm test")));
  assert.deepEqual(d.modules.web, ["web/**"]);
});

test("seams: scorers compose onto the reference score", () => {
  const { config } = makeRepo();
  const base = rankFiles(config);
  const boosted = rankFiles(config, {
    scorers: [(files) => new Map(files.map((f) => [f.rel, f.rel === "tests/test_app.py" ? 1000 : 0]))],
  });
  assert.equal(base.at(-1).rel, "tests/test_app.py", "baseline: test file ranks last");
  assert.equal(boosted[0].rel, "tests/test_app.py", "a scorer must be able to change the order");
  // Without scorers the ranking must be exactly what it was before the seam.
  assert.deepEqual(rankFiles(config, {}).map((f) => f.rel), base.map((f) => f.rel));
});

test("seams: select resolves modules and refuses unimplemented modes", () => {
  const { root } = makeRepo({
    "context.config.yaml": 'version: 1\nmodules:\n  core:\n    - "src/**"\n',
  });
  const config = loadConfig(root);
  const sel = select(config, { module: "core" });
  assert.deepEqual(sel.files.sort(), ["src/app.py", "src/core.py"]);
  assert.deepEqual(sel.seeds, []);
  assert.equal(sel.label, "core");
  assert.deepEqual(select(config).label, "all");
  assert.throws(() => select(config, { diff: "HEAD~1" }), /planned for 0\.4\.0/);
  assert.throws(() => select(config, { module: "nope" }), /unknown module/);
});

test("seams: config exposes v2 defaults without a config file", () => {
  const { config } = makeRepo();
  assert.deepEqual(config.constraints, []);
  assert.equal(config.health.duplicates, "warn");
  assert.equal(config.health.coverage, "info");
  assert.equal(config.ranking.cochange, false);
  assert.equal(config.ranking.commits, 500);
});

test("seams: every registered check runs, and one crash cannot hide the rest", () => {
  const { config } = makeRepo();
  const names = new Set(CHECKS.map((c) => c.name));
  assert.deepEqual([...names].sort(), ["agents-length", "health", "repomap", "rot", "secrets", "sync"]);
  const results = runChecks(config);
  for (const n of ["agents-length", "sync", "repomap", "secrets"]) {
    assert.ok(results.some((r) => r.name === n), `${n} did not report`);
  }
});

test("get: returns matching sections only", () => {
  const { config } = makeRepo();
  const out = getContext(config, "core", { budget: 2000 });
  assert.match(out, /src\/core\.py/);
  const miss = getContext(config, "zzz-nothing");
  assert.match(miss, /No context found/);
});
