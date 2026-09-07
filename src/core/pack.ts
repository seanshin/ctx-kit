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
import { readText } from "./fs.js";
import { buildRepoMap, rankFiles } from "./repomap.js";
import { moduleFiles, select } from "./select.js";
import { approxTokens } from "./tokens.js";

export interface PackOptions {
  profile: string;
  module?: string;
  /** Task description; ranks files by relevance (stream B, plan §4.4). */
  about?: string;
  /** Revision range or "--staged"; seeds with changes (stream D, plan §4.5). */
  diff?: string;
}

export interface PackResult {
  content: string;
  tokens: number;
  /** Suggested output path relative to repo root. */
  relOutPath: string;
}

/** Size of the cross-module orientation index inside a module pack's map. */
const ELSEWHERE_FILES = 20;
const ELSEWHERE_TOKENS = 300;

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

function fileBlock(config: CtxConfig, rel: string): string | null {
  const text = readText(config.root, rel);
  if (text === null) return null;
  const lang = LANG_BY_EXT[extname(rel)] ?? "";
  return `### ${rel}\n\n\`\`\`${lang}\n${text.trimEnd()}\n\`\`\`\n\n`;
}

/** Target files in pack order, plus how many of the front are seeds (plan §4.5). */
function targetFiles(config: CtxConfig, opts: PackOptions): { files: string[]; seedCount: number } {
  const selection = select(config, {
    module: opts.module,
    about: opts.about,
    diff: opts.diff,
  });
  // Budget cuts drop the tail, so order by importance, not alphabet.
  const ranked = rankFiles(config, { files: selection.files }).map((e) => e.rel);
  // Seeds must survive the budget, so they lead.
  const files = [...selection.seeds, ...ranked.filter((r) => !selection.seeds.includes(r))];
  return { files, seedCount: selection.seeds.length };
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
        let map: string | null = null;
        if (opts.module) {
          // A module pack gets a module-scoped map; the repo-wide cache
          // would spend the budget on unrelated files. But scoping alone
          // blinds the model to the rest of the repo (measured: it could no
          // longer say where an outside symbol lived), so a paths-only
          // index of the most-referenced files elsewhere is appended — a
          // few hundred tokens that restore orientation.
          const own = new Set(moduleFiles(config, opts.module));
          map = buildRepoMap(config, {
            budget: mapBudget - ELSEWHERE_TOKENS,
            files: [...own],
            scope: opts.module,
          });
          const elsewhere = rankFiles(config)
            .filter((e) => !own.has(e.rel))
            .slice(0, ELSEWHERE_FILES)
            .map((e) => `- ${e.rel}`);
          if (elsewhere.length > 0) {
            map +=
              `\n### Elsewhere in the repository (most referenced; ask ` +
              `search_symbol or read them directly)\n${elsewhere.join("\n")}\n`;
          }
        } else {
          const cached = join(config.root, GENERATED_DIR, "repomap.md");
          if (existsSync(cached)) {
            const cachedText = readFileSync(cached, "utf8");
            if (approxTokens(cachedText) <= mapBudget) map = cachedText;
          }
          map ??= buildRepoMap(config, { budget: mapBudget });
        }
        out += `## Repository Map\n\n${map.trim()}\n\n`;
        break;
      }
      case "target-files": {
        out += `## Target Files\n\n`;
        const reserve = tailReminder ? approxTokens(tailReminder) + 50 : 0;
        const { files, seedCount } = targetFiles(config, opts);
        const seeds = files.slice(0, seedCount);
        const expansion = files.slice(seedCount);
        let omitted = 0;

        if (opts.diff !== undefined) {
          out +=
            `_Diff range: \`${opts.diff}\`. Seeds (${seedCount} changed file${seedCount === 1 ? "" : "s"}): ` +
            (seeds.length > 0 ? seeds.map((s) => `\`${s}\``).join(", ") : "(none — no changed source files)") +
            `_\n\n`;
        }

        // Seeds must survive the budget (plan §4.5): a review pack missing
        // the changed files is worthless. Compute their combined cost up
        // front — the plain skip-if-oversized loop below (used for the
        // expansion files) would otherwise drop an oversized seed just like
        // any other file.
        const seedBlocks = seeds
          .map((rel) => ({ rel, block: fileBlock(config, rel) }))
          .filter((b): b is { rel: string; block: string } => b.block !== null);
        const seedTokens = approxTokens(seedBlocks.map((b) => b.block).join(""));

        if (seedBlocks.length > 0 && approxTokens(out) + seedTokens + reserve > budget) {
          // Degraded mode: the changed files alone don't fit. List every
          // seed path so none goes missing from the pack silently, then
          // spend the remaining budget on the single most central seed.
          out +=
            `_⚠ the ${seedBlocks.length} changed file(s) exceed the ${budget}-token budget on their ` +
            `own. Listing all seed paths; including full contents for the top-ranked one only._\n\n` +
            seeds.map((rel) => `- ${rel}`).join("\n") +
            `\n\n`;
          const top = seedBlocks[0];
          if (approxTokens(out + top.block) + reserve <= budget) {
            out += top.block;
            omitted += seedBlocks.length - 1;
          } else {
            omitted += seedBlocks.length;
          }
        } else {
          for (const { block } of seedBlocks) out += block;
        }

        for (const rel of expansion) {
          const block = fileBlock(config, rel);
          if (block === null) continue;
          // Skip rather than stop: one oversized file in the middle of the
          // ranking must not forfeit the remaining budget for the smaller,
          // still-relevant files behind it.
          if (approxTokens(out + block) + reserve > budget) {
            omitted++;
            continue;
          }
          out += block;
        }
        if (omitted > 0) {
          out +=
            `_…${omitted} file(s) omitted: they did not fit the ${budget}-token budget. ` +
            `Request them individually, or use a profile with a larger budget._\n\n`;
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
