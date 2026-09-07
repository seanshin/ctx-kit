#!/usr/bin/env node
/**
 * P4 measurement harness: context profile x model matrix.
 *
 * For each (profile, model, task): assemble the fixture's context with
 * `ctxkit pack --profile <p> --stdout`, pipe context+question to the model
 * command, grade by expected keywords, and write eval/results.md.
 *
 * Models are shell commands reading the prompt on stdin:
 *   node eval/run.mjs                                  # claude haiku + sonnet
 *   node eval/run.mjs --models haiku                   # subset
 *   node eval/run.mjs --custom "qwen=ollama run qwen3:14b"   # add a local LLM
 *
 * Real-repo runs: point at any onboarded repository and its own task file:
 *   node eval/run.mjs --fixture ../twin --tasks eval/twin-tasks.yaml \
 *     --module risk --out eval/results-twin.md
 *
 * Model processes run in an empty temp directory so they cannot cheat by
 * reading the fixture with their own tools.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(EVAL_DIR, "..");
const CLI = join(REPO_ROOT, "dist/cli.js");

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const FIXTURE = argVal("--fixture") ?? join(EVAL_DIR, "fixture");
const TASKS_FILE = argVal("--tasks") ?? join(EVAL_DIR, "tasks.yaml");
const MODULE = argVal("--module");
const OUT_FILE = argVal("--out") ?? join(EVAL_DIR, "results.md");

const profiles = (argVal("--profiles") ?? "mid,light").split(",");
const models = (argVal("--models") ?? "haiku,sonnet")
  .split(",")
  .filter(Boolean)
  .map((name) => ({ name, cmd: `claude -p --model ${name}` }));
for (const a of args.filter((_, i) => args[i - 1] === "--custom")) {
  const [name, ...cmd] = a.split("=");
  models.push({ name, cmd: cmd.join("=") });
}

const { tasks } = parse(readFileSync(TASKS_FILE, "utf8"));
const emptyCwd = mkdtempSync(join(tmpdir(), "ctxkit-eval-"));

function buildContext(profile) {
  const packArgs = [CLI, "-C", FIXTURE, "pack", "--profile", profile, "--stdout"];
  if (MODULE) packArgs.push("--module", MODULE);
  const res = spawnSync("node", packArgs, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`pack failed for ${profile}: ${res.stderr}`);
  return res.stdout;
}

const results = [];
for (const profile of profiles) {
  const context = buildContext(profile);
  const ctxTokens = Math.ceil(context.length / 4);
  for (const model of models) {
    for (const task of tasks) {
      const prompt =
        `${context}\n\n---\nAnswer using ONLY the context above. ` +
        `${task.question}\n`;
      const t0 = Date.now();
      const res = spawnSync("sh", ["-c", model.cmd], {
        input: prompt,
        cwd: emptyCwd,
        encoding: "utf8",
        timeout: 180_000,
      });
      const answer = (res.stdout ?? "").trim();
      const pass =
        res.status === 0 &&
        task.expect.some((e) => answer.toLowerCase().includes(e.toLowerCase()));
      results.push({
        profile,
        model: model.name,
        task: task.id,
        pass,
        ctxTokens,
        seconds: ((Date.now() - t0) / 1000).toFixed(1),
        answer: answer.replace(/\s+/g, " ").slice(0, 80),
      });
      console.error(
        `${pass ? "PASS" : "FAIL"} ${profile}/${model.name}/${task.id} ` +
          `(${results.at(-1).seconds}s) ${results.at(-1).answer}`,
      );
    }
  }
}

let md = `# P4 results (${new Date().toISOString().slice(0, 10)})\n\n`;
md += `| profile | model | task | pass | ctx tokens | secs | answer |\n|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  md += `| ${r.profile} | ${r.model} | ${r.task} | ${r.pass ? "✅" : "❌"} | ~${r.ctxTokens} | ${r.seconds} | ${r.answer} |\n`;
}
md += `\n## Pass rate by cell\n\n| profile | model | passed |\n|---|---|---|\n`;
for (const profile of profiles) {
  for (const model of models) {
    const cell = results.filter((r) => r.profile === profile && r.model === model.name);
    md += `| ${profile} | ${model.name} | ${cell.filter((r) => r.pass).length}/${cell.length} |\n`;
  }
}
writeFileSync(OUT_FILE, md);
console.error(`\nwrote ${OUT_FILE}`);
