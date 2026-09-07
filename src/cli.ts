#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { CONFIG_FILE, GENERATED_DIR, loadConfig } from "./core/config.js";
import { VERSION } from "./core/version.js";
import { detectProject, renderAgents, renderConfig } from "./core/detect.js";
import { runChecks } from "./core/check.js";
import { getContext } from "./core/get.js";
import { buildPack } from "./core/pack.js";
import { buildRepoMap } from "./core/repomap.js";
import { syncRules } from "./core/sync.js";
import { repomixAvailable, runRepomix } from "./adapters/repomix.js";
import {
  DEFAULT_PROFILES as EVAL_DEFAULT_PROFILES,
  DEFAULT_RESULTS_RELATIVE,
  DEFAULT_TASKS_RELATIVE,
  TASKS_TEMPLATE,
  dryRunEval,
  formatDryRunReport,
  loadTasks,
  parseModelsArg,
  runModelEval,
} from "./eval.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const program = new Command();
program
  .name("ctxkit")
  .description("Tool-neutral codebase context kit for AI coding agents")
  .version(VERSION)
  .option("-C, --dir <path>", "target repository root", ".");

function rootDir(): string {
  return resolve(program.opts<{ dir: string }>().dir);
}

function writeOutput(root: string, relPath: string, content: string, stdout: boolean): void {
  if (stdout) {
    process.stdout.write(content);
    return;
  }
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log(`wrote ${relPath}`);
}

program
  .command("init")
  .description(`scaffold ${CONFIG_FILE}, AGENTS.md and docs/ directories`)
  .option("--auto", "detect commands and module boundaries from the repo's manifests and prefill the drafts")
  .option("--ci", "also install the GitHub Actions workflow (uses Actions minutes on private repos — prefer --hooks to stay free)")
  .option("--hooks", "install a git pre-commit hook running `ctxkit check` (local and free)")
  .action((opts: { auto?: boolean; ci?: boolean; hooks?: boolean }) => {
    const root = rootDir();
    const created: string[] = [];
    let generated: Record<string, string> | null = null;
    if (opts.auto) {
      const detected = detectProject(loadConfig(root));
      generated = {
        [CONFIG_FILE]: renderConfig(detected),
        "AGENTS.md": renderAgents(detected),
      };
      console.log(
        `auto-detect: ${detected.commands.length} command(s), ` +
          `${Object.keys(detected.modules).length} module(s)`,
      );
    }
    const files: Array<readonly [string, string]> = [
      ["context.config.yaml", CONFIG_FILE],
      ["AGENTS.md", "AGENTS.md"],
    ];
    if (opts.ci) files.push(["github-actions-ctxkit.yml", ".github/workflows/ctxkit.yml"]);
    for (const [template, target] of files) {
      const dest = join(root, target);
      if (existsSync(dest)) {
        console.log(`skip ${target} (exists)`);
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        const content = generated?.[target];
        if (content !== undefined) writeFileSync(dest, content);
        else copyFileSync(join(TEMPLATES_DIR, template), dest);
        created.push(target);
      }
    }
    for (const dir of ["docs/context", join(GENERATED_DIR, "packs")]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    if (opts.hooks) {
      if (!existsSync(join(root, ".git"))) {
        console.error("skip pre-commit hook: no .git directory — run `git init` first, then re-run with --hooks");
      } else {
        const hookPath = join(root, ".git", "hooks", "pre-commit");
        if (existsSync(hookPath)) {
          console.log("skip .git/hooks/pre-commit (exists — add `ctxkit check` to it manually)");
        } else {
          mkdirSync(dirname(hookPath), { recursive: true });
          copyFileSync(join(TEMPLATES_DIR, "pre-commit"), hookPath);
          chmodSync(hookPath, 0o755);
          created.push(".git/hooks/pre-commit");
        }
      }
    }
    for (const f of created) console.log(`created ${f}`);
    console.log(
      `\nNext steps:\n` +
        `  1. Edit AGENTS.md — keep it under 150 lines, only what code can't tell.\n` +
        `  2. Define module boundaries in ${CONFIG_FILE}.\n` +
        `  3. Run: npx ctxkit map && npx ctxkit pack --profile light`,
    );
  });

program
  .command("map")
  .description(`generate the Tier 1 repository map -> ${GENERATED_DIR}/repomap.md`)
  .option("-b, --budget <tokens>", "approximate token budget", "8000")
  .option("--stdout", "print to stdout instead of writing the file")
  .action((opts: { budget: string; stdout?: boolean }) => {
    const config = loadConfig(rootDir());
    const map = buildRepoMap(config, { budget: Number(opts.budget) });
    writeOutput(config.root, join(GENERATED_DIR, "repomap.md"), map, opts.stdout ?? false);
  });

program
  .command("pack")
  .description(`assemble a profile-aware context pack -> ${GENERATED_DIR}/packs/`)
  .option("-p, --profile <name>", "consumption profile", "light")
  .option("-m, --module <name>", "restrict to a module defined in the config")
  .option("-a, --about <query>", "rank files by relevance to this task (planned: 0.4.0)")
  .option("-d, --diff <range>", "center the pack on changed files; range or --staged (planned: 0.4.0)")
  .option("--explain", "print the score breakdown for the top files (planned: 0.4.0)")
  .option("--repomix", "delegate packing to the external Repomix CLI if installed")
  .option("--stdout", "print to stdout instead of writing the file")
  .action((opts: {
    profile: string; module?: string; about?: string; diff?: string;
    explain?: boolean; repomix?: boolean; stdout?: boolean;
  }) => {
    const config = loadConfig(rootDir());
    if (opts.repomix) {
      if (!repomixAvailable()) {
        console.error("repomix not found on PATH — falling back to the internal packer");
      } else {
        const res = runRepomix(config.root, ["--style", "markdown"]);
        console.log(res.output.trim());
        if (res.ok) return;
        console.error("repomix failed — falling back to the internal packer");
      }
    }
    if (opts.explain) {
      console.error("pack --explain is planned for 0.4.0 (docs/plan-v2.md §4.4)");
      process.exitCode = 1;
      return;
    }
    const pack = buildPack(config, {
      profile: opts.profile,
      module: opts.module,
      about: opts.about,
      diff: opts.diff,
    });
    writeOutput(config.root, pack.relOutPath, pack.content, opts.stdout ?? false);
    if (!opts.stdout) console.log(`~${pack.tokens} tokens (budget ${config.profiles[opts.profile].budget})`);
  });

program
  .command("sync")
  .description("distribute AGENTS.md to per-tool rule files (CLAUDE.md, .cursorrules, ...)")
  .option("--link", "create symlinks instead of generated copies")
  .option("--force", "overwrite per-tool files not generated by ctxkit")
  .action((opts: { link?: boolean; force?: boolean }) => {
    const config = loadConfig(rootDir());
    let skipped = 0;
    for (const a of syncRules(config, opts)) {
      console.log(`${a.action.padEnd(15)} ${a.path}`);
      if (a.action === "skipped-foreign") skipped++;
    }
    if (skipped > 0) {
      console.error(
        `\n${skipped} file(s) skipped: they were not generated by ctxkit.\n` +
          `Merge their content into AGENTS.md, then re-run with --force.`,
      );
      process.exitCode = 1;
    }
  });

program
  .command("check")
  .description("CI gate: rule length, sync freshness, repomap staleness, secret scan")
  .option("--max-rule-lines <n>", "maximum AGENTS.md line count", "150")
  .option("--run-commands", "also run the commands documented in AGENTS.md — trusted repositories only (planned: 0.3.1)")
  .option("--update-baseline", "record current violations so only new ones fail (planned: 0.3.1)")
  .option("--no-baseline", "report every violation, ignoring the recorded baseline (planned: 0.3.1)")
  .action((opts: { maxRuleLines: string; runCommands?: boolean; updateBaseline?: boolean; baseline?: boolean }) => {
    const config = loadConfig(rootDir());
    if (opts.updateBaseline) {
      console.error("check --update-baseline is planned for 0.3.1 (docs/plan-v2.md §4.2)");
      process.exitCode = 1;
      return;
    }
    const results = runChecks(config, {
      maxRuleLines: Number(opts.maxRuleLines),
      runCommands: opts.runCommands,
      noBaseline: opts.baseline === false,
    });
    const icon = { ok: "✓", warn: "!", fail: "✗" } as const;
    for (const r of results) console.log(`${icon[r.level]} [${r.name}] ${r.detail}`);
    const fails = results.filter((r) => r.level === "fail").length;
    if (fails > 0) {
      console.error(`\n${fails} check(s) failed`);
      process.exitCode = 1;
    }
  });

program
  .command("get")
  .description("print context sections matching a query (for pipes and copy-paste)")
  .argument("<query>", "search term (module, symbol, or topic)")
  .option("-b, --budget <tokens>", "approximate token budget", "4000")
  .option("-k, --max-sections <n>", "maximum sections to include", "5")
  .action((query: string, opts: { budget: string; maxSections: string }) => {
    const config = loadConfig(rootDir());
    process.stdout.write(
      getContext(config, query, {
        budget: Number(opts.budget),
        maxSections: Number(opts.maxSections),
      }),
    );
  });

program
  .command("eval")
  .description("(planned: 0.3.0 — measure context profiles against a task file)")
  .option("--init", "write a tasks.yaml template")
  .option("--tasks <file>", "task definitions")
  .option("--dry-run", "inclusion rates only, without calling any model (free)")
  .option("--profiles <list>", "comma-separated profiles")
  .option("--models <list>", "comma-separated model names")
  .option("--custom <spec>", "extra model as name=command")
  .option("-m, --module <name>", "restrict packs to a module")
  .option("--out <file>", "results file")
  .option("--yes", "skip the model-call confirmation")
  .action((opts: {
    init?: boolean; tasks?: string; dryRun?: boolean; profiles?: string;
    models?: string; custom?: string; module?: string; out?: string; yes?: boolean;
  }) => {
    const config = loadConfig(rootDir());
    const tasksPath = join(config.root, opts.tasks ?? DEFAULT_TASKS_RELATIVE);

    if (opts.init) {
      if (existsSync(tasksPath)) {
        console.log(`skip ${opts.tasks ?? DEFAULT_TASKS_RELATIVE} (exists)`);
        return;
      }
      mkdirSync(dirname(tasksPath), { recursive: true });
      writeFileSync(tasksPath, TASKS_TEMPLATE);
      console.log(`wrote ${opts.tasks ?? DEFAULT_TASKS_RELATIVE}`);
      console.log(
        `\nNext steps:\n` +
          `  1. Replace the placeholders with real files/symbols from this repo.\n` +
          `  2. ctxkit eval --dry-run                # free inclusion check\n` +
          `  3. ctxkit eval --models haiku,sonnet     # calls models, asks to confirm`,
      );
      return;
    }

    if (!existsSync(tasksPath)) {
      console.error(
        `no task file at ${opts.tasks ?? DEFAULT_TASKS_RELATIVE} — run \`ctxkit eval --init\` first`,
      );
      process.exitCode = 1;
      return;
    }
    const tasks = loadTasks(tasksPath);
    const profiles = opts.profiles
      ? opts.profiles.split(",").map((s) => s.trim()).filter(Boolean)
      : EVAL_DEFAULT_PROFILES;

    if (opts.dryRun) {
      const report = dryRunEval(config, tasks, { profiles, module: opts.module });
      const rendered = formatDryRunReport(report);
      if (opts.out) {
        const outPath = join(config.root, opts.out);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, rendered);
        console.log(`wrote ${opts.out}`);
      } else {
        console.log(rendered);
      }
      return;
    }

    const models = parseModelsArg(opts.models, opts.custom);
    const outFile = join(config.root, opts.out ?? DEFAULT_RESULTS_RELATIVE);
    mkdirSync(dirname(outFile), { recursive: true });
    const result = runModelEval(config, tasks, {
      profiles,
      models,
      module: opts.module,
      outFile,
      yes: opts.yes,
    });
    if (!result) process.exitCode = 1;
  });

program
  .command("serve")
  .description("run the ctxkit MCP server over stdio (get_rules, get_repomap, get_module_context, search_symbol, make_pack)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer(rootDir());
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
