import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Check, CheckResult } from "./types.js";

/** AGENTS.md must exist and stay short: verbose rules measurably hurt agents. */
export const rulesCheck: Check = {
  name: "agents-length",
  run({ config, opts }): CheckResult[] {
    const maxRuleLines = opts.maxRuleLines ?? 150;
    const agentsPath = join(config.root, "AGENTS.md");
    if (!existsSync(agentsPath)) {
      return [{ level: "fail", name: "agents", detail: "AGENTS.md missing — run `ctxkit init`" }];
    }
    const lineCount = readFileSync(agentsPath, "utf8").split("\n").length;
    return [
      lineCount > maxRuleLines
        ? {
            level: "fail",
            name: "agents-length",
            detail: `AGENTS.md is ${lineCount} lines (max ${maxRuleLines}) — verbose rules measurably hurt agents`,
          }
        : {
            level: "ok",
            name: "agents-length",
            detail: `AGENTS.md is ${lineCount} lines (max ${maxRuleLines})`,
          },
    ];
  },
};
