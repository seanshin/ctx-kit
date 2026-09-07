#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { CONFIG_FILE, GENERATED_DIR, loadConfig } from "./core/config.js";
import { detectProject, renderAgents, renderConfig } from "./core/detect.js";
import { runChecks } from "./core/check.js";
import { getContext } from "./core/get.js";
import { buildPack } from "./core/pack.js";
import { buildRepoMap } from "./core/repomap.js";
import { syncRules } from "./core/sync.js";
import { repomixAvailable, runRepomix } from "./adapters/repomix.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const program = new Command();
program
  .name("ctxkit")
  .description("Tool-neutral codebase context kit for AI coding agents")
  .version("0.2.0")
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
  .option("--repomix", "delegate packing to the external Repomix CLI if installed")
  .option("--stdout", "print to stdout instead of writing the file")
  .action((opts: { profile: string; module?: string; repomix?: boolean; stdout?: boolean }) => {
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
    const pack = buildPack(config, { profile: opts.profile, module: opts.module });
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
  .action((opts: { maxRuleLines: string }) => {
    const config = loadConfig(rootDir());
    const results = runChecks(config, { maxRuleLines: Number(opts.maxRuleLines) });
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
