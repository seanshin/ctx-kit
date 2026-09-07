#!/usr/bin/env node
/**
 * Thin CLI wrapper around the productized harness (src/eval.ts -> built to
 * dist/eval.js by `npm run build`). Kept for the fixture-pointing workflow
 * `ctxkit eval` doesn't cover (docs/plan-v2.md §4.1 "구현 지점") — mainly
 * `--fixture <path>` to measure against a repo other than the one ctxkit is
 * invoked in, e.g. a private real-world repo (see AGENTS.md, twin-tasks.yaml).
 *
 * Models are shell commands reading the prompt on stdin:
 *   node eval/run.mjs                                  # claude haiku + sonnet
 *   node eval/run.mjs --models haiku                   # subset
 *   node eval/run.mjs --custom "qwen=ollama run qwen3:14b"   # add a local LLM
 *   node eval/run.mjs --dry-run                         # free inclusion check
 *
 * Real-repo runs: point at any onboarded repository and its own task file:
 *   node eval/run.mjs --fixture ../twin --tasks eval/twin-tasks.yaml \
 *     --module risk --out eval/results-twin.md
 *
 * Model processes run in an empty temp directory so they cannot cheat by
 * reading the fixture with their own tools (enforced in dist/eval.js).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../dist/core/config.js";
import {
  DEFAULT_PROFILES,
  DEFAULT_RESULTS_RELATIVE,
  DEFAULT_TASKS_RELATIVE,
  dryRunEval,
  formatDryRunReport,
  loadTasks,
  parseModelsArg,
  runModelEval,
} from "../dist/eval.js";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

if (!existsSync(join(dirname(EVAL_DIR), "dist", "eval.js"))) {
  console.error("dist/eval.js not found — run `npm run build` first");
  process.exit(1);
}

const FIXTURE = argVal("--fixture") ?? join(EVAL_DIR, "fixture");
const TASKS_FILE = argVal("--tasks") ?? join(EVAL_DIR, DEFAULT_TASKS_RELATIVE.split("/").pop());
const MODULE = argVal("--module");
const OUT_FILE = argVal("--out") ?? join(EVAL_DIR, DEFAULT_RESULTS_RELATIVE.split("/").pop());
const DRY_RUN = args.includes("--dry-run");
const YES = args.includes("--yes");

const profiles = (argVal("--profiles") ?? DEFAULT_PROFILES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const models = parseModelsArg(argVal("--models"), argVal("--custom"));

const config = loadConfig(FIXTURE);
const tasks = loadTasks(TASKS_FILE);

if (DRY_RUN) {
  const report = dryRunEval(config, tasks, { profiles, module: MODULE });
  console.error(formatDryRunReport(report));
  process.exit(0);
}

const result = runModelEval(config, tasks, {
  profiles,
  models,
  module: MODULE,
  outFile: OUT_FILE,
  yes: YES,
});
process.exit(result ? 0 : 1);
