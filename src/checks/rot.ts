/**
 * Rule and config rot — docs/plan-v2.md §4.3. AGENTS.md can point at paths
 * that no longer exist or commands that no longer run, and the gate would
 * stay green; `context.config.yaml` module globs can silently stop matching
 * anything after a refactor. This check catches both.
 */
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import picomatch from "picomatch";
import { readText, walkFiles } from "../core/fs.js";
import { SOURCE_EXTENSIONS } from "../adapters/symbols.js";
import type { Check, CheckContext, CheckResult } from "./types.js";

const KNOWN_RUNNERS = new Set(["npm", "pnpm", "yarn", "pytest", "cargo", "go", "make", "docker", "uv", "poetry"]);

const KNOWN_PATH_EXTENSIONS = new Set<string>([
  ...SOURCE_EXTENSIONS,
  ".json", ".yaml", ".yml", ".md", ".toml", ".lock", ".txt", ".cfg", ".ini", ".env", ".sh", ".sql",
]);

const COMMAND_TIMEOUT_MS = 120_000;

/**
 * Blank out fenced code-block bodies (keeping line numbers intact) before
 * any backtick extraction happens — otherwise every line of example code
 * becomes a path/command candidate and false positives explode
 * (docs/plan-v2.md §4.3, step 1).
 */
function stripFences(content: string): string[] {
  const lines = content.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push("");
      continue;
    }
    out.push(inFence ? "" : line);
  }
  return out;
}

/** 1-based line numbers currently inside a "## Commands" section. */
function commandSectionLines(lines: string[]): Set<number> {
  const inSection = new Set<number>();
  let active = false;
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (h) {
      active = h[2].trim().toLowerCase() === "commands";
      continue;
    }
    if (active) inSection.add(i + 1);
  }
  return inSection;
}

interface Backtick {
  text: string;
  line: number;
}

function extractBackticks(lines: string[]): Backtick[] {
  const out: Backtick[] = [];
  for (let i = 0; i < lines.length; i++) {
    const re = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i]))) out.push({ text: m[1], line: i + 1 });
  }
  return out;
}

function isPathCandidate(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (/^[a-z]+:\/\//i.test(text)) return false; // URLs
  if (text.includes("<") || text.includes(">")) return false; // <placeholder>
  if (text.includes("/")) return true;
  return KNOWN_PATH_EXTENSIONS.has(extname(text));
}

function isGlob(text: string): boolean {
  return /[*?[\]]/.test(text);
}

function pathExists(root: string, allFiles: string[], candidate: string): boolean {
  if (isGlob(candidate)) {
    const isMatch = picomatch(candidate, { dot: true });
    return allFiles.some((f) => isMatch(f));
  }
  return existsSync(join(root, candidate));
}

function isCommandCandidate(text: string): boolean {
  const first = text.trim().split(/\s+/)[0];
  return KNOWN_RUNNERS.has(first);
}

function runnerOnPath(cache: Map<string, boolean>, runner: string): boolean {
  const cached = cache.get(runner);
  if (cached !== undefined) return cached;
  const checker = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(checker, [runner], { encoding: "utf8" });
  const found = res.status === 0;
  cache.set(runner, found);
  return found;
}

function checkAgentsRot(ctx: CheckContext): CheckResult[] {
  const { config, opts } = ctx;
  const agentsPath = join(config.root, "AGENTS.md");
  if (!existsSync(agentsPath)) return []; // rules-check already reports this as fail

  const raw = readText(config.root, "AGENTS.md") ?? "";
  const lines = stripFences(raw);
  const commandsSection = commandSectionLines(lines);
  const backticks = extractBackticks(lines);

  const results: CheckResult[] = [];

  // Path candidates: existence, anywhere in the file.
  const pathCandidates = backticks.filter((b) => isPathCandidate(b.text));
  if (pathCandidates.length > 0) {
    const allFiles = walkFiles(config.root, { exclude: config.exclude });
    let violations = 0;
    for (const b of pathCandidates) {
      if (!pathExists(config.root, allFiles, b.text)) {
        violations++;
        results.push({
          level: "warn", // docs/plan-v2.md §4.3: starts at warn, promoted after real-world false-positive checks
          name: "rot-path",
          detail: `AGENTS.md:${b.line} references "${b.text}", which does not exist${isGlob(b.text) ? " (glob matched 0 files)" : ""}`,
        });
      }
    }
    if (violations === 0) {
      results.push({ level: "ok", name: "rot-path", detail: `${pathCandidates.length} path reference(s) in AGENTS.md all exist` });
    }
  }

  // Command candidates: only inside "## Commands", only known runners.
  const commandCandidates = backticks.filter((b) => commandsSection.has(b.line) && isCommandCandidate(b.text));
  if (opts.runCommands) {
    if (commandCandidates.length > 0) {
      console.log(`rot: --run-commands will execute ${commandCandidates.length} command(s) from AGENTS.md "## Commands" (timeout ${COMMAND_TIMEOUT_MS / 1000}s each):`);
      for (const b of commandCandidates) console.log(`  $ ${b.text}`);
    }
    for (const b of commandCandidates) {
      const res = spawnSync(b.text, { cwd: config.root, shell: true, timeout: COMMAND_TIMEOUT_MS, encoding: "utf8" });
      if (res.error || res.status !== 0) {
        const why = res.error?.message ?? (res.signal ? `killed by ${res.signal}` : `exit ${res.status}`);
        results.push({ level: "fail", name: "rot-command", detail: `AGENTS.md:${b.line} \`${b.text}\` failed: ${why}` });
      } else {
        results.push({ level: "ok", name: "rot-command", detail: `AGENTS.md:${b.line} \`${b.text}\` ran successfully` });
      }
    }
  } else if (commandCandidates.length > 0) {
    const runnerCache = new Map<string, boolean>();
    let missing = 0;
    for (const b of commandCandidates) {
      const runner = b.text.trim().split(/\s+/)[0];
      if (!runnerOnPath(runnerCache, runner)) {
        missing++;
        results.push({ level: "warn", name: "rot-command", detail: `AGENTS.md:${b.line} \`${b.text}\` — runner "${runner}" not found on PATH (pass --run-commands to actually execute)` });
      }
    }
    if (missing === 0) {
      results.push({ level: "ok", name: "rot-command", detail: `${commandCandidates.length} command(s) in AGENTS.md "## Commands" have their runner on PATH` });
    }
  }

  return results;
}

/** context.config.yaml module globs matching 0 files = config rot (fail). */
function checkModuleGlobRot(ctx: CheckContext): CheckResult[] {
  const { config } = ctx;
  const results: CheckResult[] = [];
  for (const [name, globs] of Object.entries(config.modules)) {
    const files = walkFiles(config.root, { include: globs, exclude: config.exclude });
    if (files.length === 0) {
      results.push({
        level: "fail",
        name: "rot-module",
        detail: `module "${name}" (${globs.join(", ")}) matches 0 files — config rot, or the module boundary broke in a refactor`,
      });
    } else {
      results.push({ level: "ok", name: "rot-module", detail: `module "${name}" matches ${files.length} file(s)` });
    }
  }
  return results;
}

export const rotCheck: Check = {
  name: "rot",
  run(ctx: CheckContext): CheckResult[] {
    return [...checkAgentsRot(ctx), ...checkModuleGlobRot(ctx)];
  },
};
