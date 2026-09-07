import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../core/config.js";
import { walkFiles } from "../core/fs.js";
import type { Check, CheckResult } from "./types.js";

const SECRET_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  {
    label: "API key assignment",
    re: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  },
];

/**
 * Scans everything destined for an LLM. These artifacts are exactly the
 * files people paste into external services, which makes them the highest
 * value place to scan and the easiest to forget.
 */
export const secretsCheck: Check = {
  name: "secrets",
  run({ config }): CheckResult[] {
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
      results.push({
        level: "ok",
        name: "secrets",
        detail: "no secret patterns in rules/context/generated files",
      });
    }
    return results;
  },
};
