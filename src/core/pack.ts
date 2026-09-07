/**
 * Profile-aware context pack assembly (the file interface, Tier "pack").
 *
 * Section order follows the profile's `inject` list. Rules go at the front
 * and a short rule reminder is appended at the back, because long-context
 * models recall the start and end of a prompt far better than the middle.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { GENERATED_DIR, type CtxConfig } from "./config.js";
import { readText, walkFiles } from "./fs.js";
import { buildRepoMap, rankFiles } from "./repomap.js";
import { approxTokens } from "./tokens.js";
import { SOURCE_EXTENSIONS } from "../adapters/symbols.js";

export interface PackOptions {
  profile: string;
  module?: string;
}

export interface PackResult {
  content: string;
  tokens: number;
  /** Suggested output path relative to repo root. */
  relOutPath: string;
}

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".py": "python",
  ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".cs": "csharp",
  ".rb": "ruby", ".php": "php", ".swift": "swift",
};

function readAgents(config: CtxConfig): string | null {
  const path = join(config.root, "AGENTS.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function agentsSummary(agents: string, maxLines = 40): string {
  return agents.split("\n").slice(0, maxLines).join("\n");
}

function targetFiles(config: CtxConfig, moduleName?: string): string[] {
  let files: string[];
  if (moduleName) {
    const globs = config.modules[moduleName];
    if (!globs) {
      const known = Object.keys(config.modules).join(", ") || "(none defined)";
      throw new Error(`unknown module "${moduleName}" — defined modules: ${known}`);
    }
    files = walkFiles(config.root, { include: globs, exclude: config.exclude });
  } else {
    files = walkFiles(config.root, { exclude: config.exclude }).filter((f) =>
      SOURCE_EXTENSIONS.has(extname(f)),
    );
  }
  // Budget cuts drop the tail, so order by importance, not alphabet.
  return rankFiles(config, files).map((e) => e.rel);
}

export function buildPack(config: CtxConfig, opts: PackOptions): PackResult {
  const profile = config.profiles[opts.profile];
  if (!profile) {
    throw new Error(
      `unknown profile "${opts.profile}" — defined profiles: ${Object.keys(config.profiles).join(", ")}`,
    );
  }
  const budget = profile.budget;
  const agents = readAgents(config);

  const header =
    `<!-- ctxkit:v1 pack profile=${opts.profile}` +
    (opts.module ? ` module=${opts.module}` : "") +
    ` generated=${new Date().toISOString()} budget=${budget} -->\n` +
    `# Context Pack: ${opts.module ?? "all"} (${opts.profile})\n\n`;

  let out = header;
  let tailReminder = "";

  for (const section of profile.inject) {
    switch (section) {
      case "agents": {
        if (agents) out += `## Project Rules (AGENTS.md)\n\n${agents.trim()}\n\n`;
        break;
      }
      case "agents-summary": {
        if (agents) {
          out += `## Project Rules (summary)\n\n${agentsSummary(agents).trim()}\n\n`;
          tailReminder = agentsSummary(agents, 12).trim();
        }
        break;
      }
      case "repomap": {
        // Cap the map at a third of the pack budget: a large cached map
        // would otherwise starve the target-files section (found on the
        // first real-scale repo — an 8k-token map in a 12k-token pack).
        const mapBudget = Math.min(Math.floor(budget / 3), 4000);
        const cached = join(config.root, GENERATED_DIR, "repomap.md");
        let map: string | null = null;
        if (existsSync(cached)) {
          const cachedText = readFileSync(cached, "utf8");
          if (approxTokens(cachedText) <= mapBudget) map = cachedText;
        }
        map ??= buildRepoMap(config, { budget: mapBudget });
        out += `## Repository Map\n\n${map.trim()}\n\n`;
        break;
      }
      case "target-files": {
        out += `## Target Files\n\n`;
        const reserve = tailReminder ? approxTokens(tailReminder) + 50 : 0;
        for (const rel of targetFiles(config, opts.module)) {
          const text = readText(config.root, rel);
          if (text === null) continue;
          const lang = LANG_BY_EXT[extname(rel)] ?? "";
          const block = `### ${rel}\n\n\`\`\`${lang}\n${text.trimEnd()}\n\`\`\`\n\n`;
          if (approxTokens(out + block) + reserve > budget) {
            out += `_…remaining files omitted (budget ${budget} tokens). Request them individually._\n\n`;
            break;
          }
          out += block;
        }
        break;
      }
      default:
        throw new Error(`unknown inject section "${section}" in profile "${opts.profile}"`);
    }
  }

  if (tailReminder) {
    out += `## Rule Reminder\n\n${tailReminder}\n`;
  }

  const relOutPath = join(GENERATED_DIR, "packs", `${opts.module ?? "all"}-${opts.profile}.md`);
  return { content: out, tokens: approxTokens(out), relOutPath };
}
