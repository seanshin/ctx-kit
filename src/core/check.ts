/**
 * Repository health checks (`ctxkit check`) — the CI gate.
 *
 * fail = exit non-zero in CI; warn = informational. Repomap freshness is
 * mtime-based and therefore only a warning (git checkouts do not preserve
 * mtimes).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { GENERATED_DIR, type CtxConfig } from "./config.js";
import { walkFiles } from "./fs.js";
import { checkSync } from "./sync.js";
import { SOURCE_EXTENSIONS } from "../adapters/symbols.js";

export interface CheckResult {
  level: "ok" | "warn" | "fail";
  name: string;
  detail: string;
}

export interface CheckOptions {
  maxRuleLines?: number;
}

const SECRET_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { label: "API key assignment", re: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

function scanSecrets(config: CtxConfig): CheckResult[] {
  const results: CheckResult[] = [];
  const candidates = [
    ...(existsSync(join(config.root, "AGENTS.md")) ? ["AGENTS.md"] : []),
    ...walkFiles(config.root, { include: ["docs/context/**", `${GENERATED_DIR}/**`] }),
  ];
  for (const rel of candidates) {
    const lines = readFileSync(join(config.root, rel), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { label, re } of SECRET_PATTERNS) {
        if (re.test(lines[i])) {
          results.push({
            level: "fail",
            name: "secrets",
            detail: `possible ${label} at ${rel}:${i + 1} — packs get pasted into external LLMs`,
          });
        }
      }
    }
  }
  if (results.length === 0) {
    results.push({ level: "ok", name: "secrets", detail: "no secret patterns in rules/context/generated files" });
  }
  return results;
}

export function runChecks(config: CtxConfig, opts: CheckOptions = {}): CheckResult[] {
  const maxRuleLines = opts.maxRuleLines ?? 150;
  const results: CheckResult[] = [];

  // 1. AGENTS.md presence and length discipline.
  const agentsPath = join(config.root, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    results.push({ level: "fail", name: "agents", detail: "AGENTS.md missing — run `ctxkit init`" });
  } else {
    const lineCount = readFileSync(agentsPath, "utf8").split("\n").length;
    results.push(
      lineCount > maxRuleLines
        ? {
            level: "fail",
            name: "agents-length",
            detail: `AGENTS.md is ${lineCount} lines (max ${maxRuleLines}) — verbose rules measurably hurt agents`,
          }
        : { level: "ok", name: "agents-length", detail: `AGENTS.md is ${lineCount} lines (max ${maxRuleLines})` },
    );
  }

  // 2. Per-tool rule files in sync with AGENTS.md.
  for (const s of checkSync(config)) {
    results.push(
      s.status === "ok"
        ? { level: "ok", name: "sync", detail: `${s.path} up to date` }
        : s.status === "missing"
          ? { level: "warn", name: "sync", detail: `${s.path} missing — run \`ctxkit sync\`` }
          : { level: "fail", name: "sync", detail: `${s.path} differs from AGENTS.md — run \`ctxkit sync\`` },
    );
  }

  // 3. Repomap freshness (mtime heuristic — warn only).
  const mapPath = join(config.root, GENERATED_DIR, "repomap.md");
  if (!existsSync(mapPath)) {
    results.push({ level: "warn", name: "repomap", detail: "repomap.md missing — run `ctxkit map`" });
  } else {
    const mapTime = statSync(mapPath).mtimeMs;
    const staleSource = walkFiles(config.root, { exclude: config.exclude })
      .filter((f) => SOURCE_EXTENSIONS.has(extname(f)))
      .find((f) => statSync(join(config.root, f)).mtimeMs > mapTime);
    results.push(
      staleSource
        ? { level: "warn", name: "repomap", detail: `${staleSource} newer than repomap.md — run \`ctxkit map\`` }
        : { level: "ok", name: "repomap", detail: "repomap.md newer than all source files" },
    );
  }

  // 4. Secrets in anything that gets shipped to an LLM.
  results.push(...scanSecrets(config));

  return results;
}
