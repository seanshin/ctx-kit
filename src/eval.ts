/**
 * `ctxkit eval` — measure context profiles against a task file (plan
 * docs/plan-v2.md §4.1). This is the productized form of `eval/run.mjs`,
 * which now imports from here and stays only as a CLI-argument-compatible
 * wrapper (docs/plan-v2.md §4.1 "구현 지점").
 *
 * Two ways to score a (profile, task) cell:
 *   - `dryRunEval` — free, no model call. Builds each profile's pack and
 *     checks whether `expect_file` made it into the Repository Map
 *     (`outline_hit`) and/or the Target Files section (`content_hit`).
 *   - `runModelEval` — calls a model per (profile × model × task) cell and
 *     grades the answer against `expect`. The only path in this module that
 *     spends money or time; always confirmed before running (§4.1).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { buildPack } from "./core/pack.js";
import type { CtxConfig } from "./core/config.js";

export interface EvalTask {
  id: string;
  question: string;
  /** Pass if any of these substrings (case-insensitive) appears in the answer. */
  expect: string[];
  /**
   * Repo-relative path of the file that actually answers the question.
   * Required for `--dry-run` inclusion scoring; optional for model runs.
   */
  expect_file?: string;
}

export interface ModelSpec {
  name: string;
  /** Shell command; reads the prompt on stdin (`sh -c`, no shell metachar risk from us). */
  cmd: string;
}

export const DEFAULT_PROFILES = ["mid", "light"];
export const DEFAULT_MODELS_SPEC = "haiku,sonnet";
export const DEFAULT_TASKS_RELATIVE = "eval/tasks.yaml";
export const DEFAULT_RESULTS_RELATIVE = "eval/results.md";

/**
 * `ctxkit eval --init` output. Comments explain how to design a set of
 * tasks that actually discriminates between profiles/models rather than
 * ones every profile passes (structure) or every profile fails (missing
 * context) — see eval/findings.md for the pattern this mirrors.
 */
export const TASKS_TEMPLATE = `# ctxkit eval tasks (docs/plan-v2.md §4.1).
#
# Each task must be answerable ONLY from the context pack the model is
# given — it never sees the repository directly.
#
# Fields:
#   id            short slug; shows up in the results table
#   question      asked with the assembled pack as the only context
#   expect        pass if ANY of these substrings appears in the answer
#                 (case-insensitive)
#   expect_file   repo-relative path of the file that actually answers the
#                 question. Required for \`--dry-run\` (free, no model call);
#                 optional for model runs.
#
# Designing a DISCRIMINATING set (this is the part that matters):
#   - Add at least one "structure" task answerable from the Repository Map
#     alone (a symbol's defining file, a module's shape) — this should pass
#     even on the cheapest profile.
#   - Add at least one "detail" task that needs the file's actual source
#     (an implementation constant, a default value, error-handling logic) —
#     this should FAIL on profiles without a Target Files section (e.g.
#     \`mid\`) and PASS once file contents are included (e.g. \`light\`).
#     If every profile passes or every profile fails a task, it isn't
#     telling you anything — replace it.
#   - Point expect_file at whichever file the model would actually need to
#     read, not just the first plausible one; \`--dry-run\` checks this file
#     specifically, so a wrong guess here gives a false 0% or false 100%.
#   - Prefer 3+ tasks across a couple of files/modules over one file
#     repeated three ways, so ranking bugs in one file don't dominate the
#     whole report.
#
# Run \`ctxkit eval --tasks tasks.yaml --dry-run\` after writing these — it's
# free and tells you immediately whether expect_file is actually reachable
# by the profiles you plan to test.

tasks:
  - id: q1-structure
    question: "Which file defines <symbol>? Answer with the file path only."
    expect: ["<path/to/file.ext>"]
    expect_file: "<path/to/file.ext>"
  - id: q2-detail
    question: "What is <some implementation detail>? Answer with the value only."
    expect: ["<expected substring>"]
    expect_file: "<path/to/file.ext>"
  - id: q3-callgraph
    question: "Inside <function>, which function computes <result>? Answer with the function name only."
    expect: ["<callee name>"]
    expect_file: "<path/to/file.ext>"
`;

export function loadTasks(path: string): EvalTask[] {
  if (!existsSync(path)) {
    throw new Error(`no task file at ${path} — run \`ctxkit eval --init\` to create one`);
  }
  const parsed = parse(readFileSync(path, "utf8")) as { tasks?: EvalTask[] } | null;
  const tasks = parsed?.tasks ?? [];
  if (tasks.length === 0) {
    throw new Error(`${path}: no tasks defined (expected a top-level "tasks:" list)`);
  }
  for (const t of tasks) {
    if (!t.id || !t.question || !Array.isArray(t.expect) || t.expect.length === 0) {
      throw new Error(
        `${path}: task ${JSON.stringify(t.id ?? t)} is missing id/question/expect`,
      );
    }
  }
  return tasks;
}

export function parseModelsArg(models: string | undefined, custom: string | undefined): ModelSpec[] {
  const list: ModelSpec[] = (models ?? DEFAULT_MODELS_SPEC)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, cmd: `claude -p --model ${name}` }));
  if (custom) {
    const eq = custom.indexOf("=");
    if (eq === -1) {
      throw new Error(`--custom expects "name=command", got "${custom}"`);
    }
    list.push({ name: custom.slice(0, eq), cmd: custom.slice(eq + 1) });
  }
  return list;
}

/**
 * The pack's own top-level section headings (src/core/pack.ts). A
 * Repository Map section itself contains `## <file>` sub-headings per
 * ranked file, so slicing at "the next `## `" would stop at the first file
 * entry instead of the next real section — bound the slice to these known
 * headings instead.
 */
const PACK_SECTION_HEADINGS = [
  "Project Rules (AGENTS.md)",
  "Project Rules (summary)",
  "Repository Map",
  "Target Files",
  "Rule Reminder",
];

/** Slice out one `## <heading>` section, up to the next known section heading. */
function extractSection(content: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start === -1) return "";
  const rest = content.slice(start + marker.length);
  let end = rest.length;
  for (const h of PACK_SECTION_HEADINGS) {
    if (h === heading) continue;
    const idx = rest.indexOf(`\n## ${h}`);
    if (idx !== -1 && idx < end) end = idx;
  }
  return rest.slice(0, end);
}

export interface DryRunCell {
  profile: string;
  task: string;
  expectFile?: string;
  /** null when the task has no expect_file — excluded from rates, not a miss. */
  outlineHit: boolean | null;
  contentHit: boolean | null;
}

export interface DryRunProfileRate {
  profile: string;
  evaluated: number;
  outlineHits: number;
  contentHits: number;
  outlineRate: number;
  contentRate: number;
}

export interface DryRunReport {
  cells: DryRunCell[];
  rates: DryRunProfileRate[];
  /** Task ids with no expect_file, so their cells couldn't be scored. */
  skippedTasks: string[];
}

/**
 * Free inclusion check (docs/plan-v2.md §4.1): builds one pack per profile
 * (not per task — the pack doesn't depend on the question) and checks each
 * task's expect_file against it. Zero model calls.
 */
export function dryRunEval(
  config: CtxConfig,
  tasks: EvalTask[],
  opts: { profiles: string[]; module?: string },
): DryRunReport {
  const cells: DryRunCell[] = [];
  const skippedTasks = new Set<string>();

  for (const profile of opts.profiles) {
    const pack = buildPack(config, { profile, module: opts.module });
    const outlineSection = extractSection(pack.content, "Repository Map");
    const targetSection = extractSection(pack.content, "Target Files");
    for (const task of tasks) {
      if (!task.expect_file) {
        skippedTasks.add(task.id);
        cells.push({ profile, task: task.id, outlineHit: null, contentHit: null });
        continue;
      }
      cells.push({
        profile,
        task: task.id,
        expectFile: task.expect_file,
        outlineHit: outlineSection.includes(task.expect_file),
        contentHit: targetSection.includes(`### ${task.expect_file}`),
      });
    }
  }

  const rates: DryRunProfileRate[] = opts.profiles.map((profile) => {
    const scored = cells.filter((c) => c.profile === profile && c.outlineHit !== null);
    const outlineHits = scored.filter((c) => c.outlineHit).length;
    const contentHits = scored.filter((c) => c.contentHit).length;
    return {
      profile,
      evaluated: scored.length,
      outlineHits,
      contentHits,
      outlineRate: scored.length ? outlineHits / scored.length : 0,
      contentRate: scored.length ? contentHits / scored.length : 0,
    };
  });

  return { cells, rates, skippedTasks: [...skippedTasks] };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatDryRunReport(report: DryRunReport): string {
  let md = `# ctxkit eval --dry-run (${new Date().toISOString().slice(0, 10)})\n\n`;
  md += `Free inclusion check — no model was called.\n\n`;
  md += `| profile | task | expect_file | outline_hit | content_hit |\n|---|---|---|---|---|\n`;
  for (const c of report.cells) {
    if (c.outlineHit === null) {
      md += `| ${c.profile} | ${c.task} | _(no expect_file)_ | – | – |\n`;
      continue;
    }
    md += `| ${c.profile} | ${c.task} | ${c.expectFile} | ${c.outlineHit ? "✅" : "❌"} | ${c.contentHit ? "✅" : "❌"} |\n`;
  }
  md += `\n## Inclusion rate by profile\n\n| profile | evaluated | outline_hit | content_hit |\n|---|---|---|---|\n`;
  for (const r of report.rates) {
    const outline = r.evaluated ? `${r.outlineHits}/${r.evaluated} (${pct(r.outlineRate)})` : "n/a (0 scored)";
    const content = r.evaluated ? `${r.contentHits}/${r.evaluated} (${pct(r.contentRate)})` : "n/a (0 scored)";
    md += `| ${r.profile} | ${r.evaluated} | ${outline} | ${content} |\n`;
  }
  if (report.skippedTasks.length > 0) {
    md +=
      `\n_Note: task(s) ${report.skippedTasks.join(", ")} have no \`expect_file\` and were ` +
      `excluded from the rates above. Add \`expect_file: <repo-relative path>\` to each task ` +
      `to measure inclusion — see \`ctxkit eval --init\` for the template._\n`;
  }
  return md;
}

export interface ModelEvalResult {
  profile: string;
  model: string;
  task: string;
  pass: boolean;
  ctxTokens: number;
  seconds: number;
  answer: string;
}

export function plannedCallCount(profiles: string[], models: ModelSpec[], tasks: EvalTask[]): number {
  return profiles.length * models.length * tasks.length;
}

/**
 * Blocking y/N prompt on stdin. Reading fd 0 synchronously can throw in
 * some non-interactive environments (no controlling terminal, no pipe) —
 * treat that the same as "no" rather than hanging or crashing.
 */
function defaultConfirm(message: string): boolean {
  process.stdout.write(`${message} [y/N] `);
  const buf = Buffer.alloc(4096);
  let n = 0;
  try {
    n = readSync(0, buf, 0, buf.length, null);
  } catch {
    return false;
  }
  const answer = buf.toString("utf8", 0, n).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

export interface RunEvalOptions {
  profiles: string[];
  models: ModelSpec[];
  module?: string;
  /** Absolute path the results markdown is written to. */
  outFile: string;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Injectable for tests and non-TTY callers; defaults to a stdin y/N prompt. */
  confirm?: (message: string) => boolean;
  log?: (line: string) => void;
}

export interface RunEvalReport {
  outFile: string;
  results: ModelEvalResult[];
}

function formatResultsMarkdown(
  profiles: string[],
  models: ModelSpec[],
  results: ModelEvalResult[],
): string {
  let md = `# ctxkit eval results (${new Date().toISOString().slice(0, 10)})\n\n`;
  md += `| profile | model | task | pass | ctx tokens | secs | answer |\n|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.profile} | ${r.model} | ${r.task} | ${r.pass ? "✅" : "❌"} | ~${r.ctxTokens} | ${r.seconds.toFixed(1)} | ${r.answer} |\n`;
  }
  md += `\n## Pass rate by cell\n\n| profile | model | passed |\n|---|---|---|\n`;
  for (const profile of profiles) {
    for (const model of models) {
      const cell = results.filter((r) => r.profile === profile && r.model === model.name);
      md += `| ${profile} | ${model.name} | ${cell.filter((r) => r.pass).length}/${cell.length} |\n`;
    }
  }
  return md;
}

/**
 * The only function in this module that calls a model. Always prints the
 * planned call count first and — unless `opts.yes` — blocks on confirmation
 * before spending a single call (docs/plan-v2.md §4.1).
 *
 * Returns null without touching a model if the count is 0 or the user
 * declines.
 */
export function runModelEval(
  config: CtxConfig,
  tasks: EvalTask[],
  opts: RunEvalOptions,
): RunEvalReport | null {
  const log = opts.log ?? ((line: string) => console.error(line));
  const count = plannedCallCount(opts.profiles, opts.models, tasks);
  log(
    `planned: ${opts.profiles.length} profile(s) × ${opts.models.length} model(s) × ` +
      `${tasks.length} task(s) = ${count} model call(s)`,
  );
  if (count === 0) {
    log("nothing to run (no profiles, models, or tasks)");
    return null;
  }
  if (!opts.yes) {
    const confirm = opts.confirm ?? defaultConfirm;
    if (!confirm(`Proceed with ${count} model call(s)?`)) {
      log("aborted (pass --yes to skip this prompt)");
      return null;
    }
  }

  const emptyCwd = mkdtempSync(join(tmpdir(), "ctxkit-eval-"));
  const results: ModelEvalResult[] = [];
  for (const profile of opts.profiles) {
    const pack = buildPack(config, { profile, module: opts.module });
    for (const model of opts.models) {
      for (const task of tasks) {
        const prompt =
          `${pack.content}\n\n---\nAnswer using ONLY the context above. ${task.question}\n`;
        const t0 = Date.now();
        const res = spawnSync("sh", ["-c", model.cmd], {
          input: prompt,
          cwd: emptyCwd,
          encoding: "utf8",
          timeout: 180_000,
        });
        const answer = (res.stdout ?? "").trim();
        const pass =
          res.status === 0 && task.expect.some((e) => answer.toLowerCase().includes(e.toLowerCase()));
        const result: ModelEvalResult = {
          profile,
          model: model.name,
          task: task.id,
          pass,
          ctxTokens: pack.tokens,
          seconds: (Date.now() - t0) / 1000,
          answer: answer.replace(/\s+/g, " ").slice(0, 80),
        };
        results.push(result);
        log(
          `${pass ? "PASS" : "FAIL"} ${profile}/${model.name}/${task.id} ` +
            `(${result.seconds.toFixed(1)}s) ${result.answer}`,
        );
      }
    }
  }

  const md = formatResultsMarkdown(opts.profiles, opts.models, results);
  writeFileSync(opts.outFile, md);
  log(`\nwrote ${opts.outFile}`);
  return { outFile: opts.outFile, results };
}
