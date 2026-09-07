import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/core/config.js";
import {
  dryRunEval,
  formatDryRunReport,
  loadTasks,
  plannedCallCount,
  runModelEval,
} from "../dist/eval.js";

/** Scaffold a small repo whose files reference each other, so ranking is stable. */
function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-eval-test-"));
  const defaults = {
    "AGENTS.md": "# AGENTS.md\n\n## Commands\n\n- Test: `pytest`\n",
    "lib/discount.py":
      "def apply_discount(total, tier):\n    if tier == 'gold':\n        return total * 0.8\n    return total\n",
    "lib/orders.py":
      "from discount import apply_discount\n\ndef place_order(item, tier):\n    total = calc_total(item)\n    return apply_discount(total, tier)\n\ndef calc_total(item):\n    return item.price\n",
  };
  for (const [rel, content] of Object.entries({ ...defaults, ...files })) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, config: loadConfig(root) };
}

function writeTasks(root, yaml) {
  const path = join(root, "eval-tasks.yaml");
  writeFileSync(path, yaml);
  return path;
}

test("eval --dry-run: computes outline_hit and content_hit per (profile x task)", () => {
  const { root, config } = makeRepo();
  const tasksPath = writeTasks(
    root,
    "tasks:\n" +
      '  - id: q1\n    question: "Where is apply_discount?"\n    expect: ["discount.py"]\n    expect_file: "lib/discount.py"\n',
  );
  const tasks = loadTasks(tasksPath);

  const report = dryRunEval(config, tasks, { profiles: ["mid", "light"], module: undefined });

  const mid = report.cells.find((c) => c.profile === "mid" && c.task === "q1");
  const light = report.cells.find((c) => c.profile === "light" && c.task === "q1");

  // Both profiles inject a repomap, so the file's path shows up in the outline.
  assert.equal(mid.outlineHit, true);
  assert.equal(light.outlineHit, true);
  // `mid` has no target-files section at all -> content_hit must be false,
  // not merely unset; `light` inlines the source -> content_hit true.
  assert.equal(mid.contentHit, false);
  assert.equal(light.contentHit, true);

  const midRate = report.rates.find((r) => r.profile === "mid");
  const lightRate = report.rates.find((r) => r.profile === "light");
  assert.equal(midRate.evaluated, 1);
  assert.equal(midRate.outlineRate, 1);
  assert.equal(midRate.contentRate, 0);
  assert.equal(lightRate.contentRate, 1);

  // Rendered report is free-form text, but it must reflect the same verdicts.
  const rendered = formatDryRunReport(report);
  assert.match(rendered, /lib\/discount\.py/);
  assert.match(rendered, /Inclusion rate by profile/);
});

test("eval --dry-run: a task with no expect_file is skipped, not scored as a miss", () => {
  const { root, config } = makeRepo();
  const tasksPath = writeTasks(
    root,
    "tasks:\n" +
      '  - id: no-file\n    question: "What does this repo do?"\n    expect: ["discount"]\n' +
      '  - id: q1\n    question: "Where is apply_discount?"\n    expect: ["discount.py"]\n    expect_file: "lib/discount.py"\n',
  );
  const tasks = loadTasks(tasksPath);

  const report = dryRunEval(config, tasks, { profiles: ["light"] });

  const skippedCell = report.cells.find((c) => c.task === "no-file");
  assert.equal(skippedCell.outlineHit, null);
  assert.equal(skippedCell.contentHit, null);
  assert.deepEqual(report.skippedTasks, ["no-file"]);

  // The rate denominator only counts the scoreable task, not the skipped one.
  const rate = report.rates.find((r) => r.profile === "light");
  assert.equal(rate.evaluated, 1);

  // The rendered report must tell the user why, and how to fix it.
  const rendered = formatDryRunReport(report);
  assert.match(rendered, /no-file/);
  assert.match(rendered, /expect_file/);
  assert.match(rendered, /--init/);
});

test("eval: prints the planned call count and never calls a model without confirmation", () => {
  const { root, config } = makeRepo();
  const tasksPath = writeTasks(
    root,
    "tasks:\n" +
      '  - id: q1\n    question: "Where is apply_discount?"\n    expect: ["discount.py"]\n' +
      '  - id: q2\n    question: "What does calc_total do?"\n    expect: ["price"]\n',
  );
  const tasks = loadTasks(tasksPath);
  const models = [
    { name: "fake-a", cmd: "true" },
    { name: "fake-b", cmd: "true" },
  ];

  assert.equal(plannedCallCount(["mid", "light"], models, tasks), 8);

  let asked = null;
  let confirmCalls = 0;
  const outFile = join(root, "results.md");
  const result = runModelEval(config, tasks, {
    profiles: ["mid", "light"],
    models,
    outFile,
    confirm: (message) => {
      asked = message;
      confirmCalls++;
      return false; // decline — must abort before spawning anything
    },
    log: () => {},
  });

  assert.equal(result, null);
  assert.equal(confirmCalls, 1);
  assert.match(asked, /8 model call/);
});

test("eval: an empty plan (no profiles) is a no-op and never prompts", () => {
  const { root, config } = makeRepo();
  const tasksPath = writeTasks(
    root,
    "tasks:\n  - id: q1\n    question: \"x\"\n    expect: [\"y\"]\n",
  );
  const tasks = loadTasks(tasksPath);
  let confirmCalls = 0;
  const result = runModelEval(config, tasks, {
    profiles: [],
    models: [{ name: "fake", cmd: "true" }],
    outFile: join(root, "results.md"),
    confirm: () => {
      confirmCalls++;
      return true;
    },
    log: () => {},
  });
  assert.equal(result, null);
  assert.equal(confirmCalls, 0);
});

test("eval: loadTasks rejects a task missing required fields", () => {
  const { root } = makeRepo();
  const tasksPath = writeTasks(root, "tasks:\n  - id: bad\n    question: \"x\"\n");
  assert.throws(() => loadTasks(tasksPath), /missing id\/question\/expect/);
});
