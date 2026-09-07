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
import { buildRepoMap, rankFiles, type Scorer } from "./repomap.js";
import { moduleFiles, select } from "./select.js";
import { approxTokens } from "./tokens.js";
import { makeQueryScorer } from "../scorers/query.js";
import { coChangeOutsideModule, coChangeSeeds, makeCoChangeScorer } from "../scorers/cochange.js";

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
  /** Things the caller should be told — surfaced by the CLI and MCP. */
  notes: string[];
}

/** Size of the cross-module orientation index inside a module pack's map. */
const ELSEWHERE_FILES = 20;
const ELSEWHERE_TOKENS = 300;
/**
 * Co-change reach beyond the module (plan §4.7 problem: a re-rank can only
 * ever surface files already in the candidate pool, so a module pack could
 * never point at a file it doesn't contain). A handful, not twenty — this
 * rides inside the same `ELSEWHERE_TOKENS` allowance as the reference-based
 * list above, so it stays small on purpose.
 */
const COCHANGE_ELSEWHERE_FILES = 5;

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

/**
 * Every ranking signal, assembled in one place so the packer and `--explain`
 * can never disagree about what ran. `--about` re-ranks the same candidates
 * rather than filtering them (core/select.ts), and co-change only applies
 * relative to a seed set and only when enabled — with neither, this is empty
 * and `rankFiles` takes exactly the path it always did.
 */
function assembleScorers(
  config: CtxConfig,
  opts: PackOptions,
  selection: ReturnType<typeof select>,
): Scorer[] {
  const scorers: Scorer[] = opts.about ? [makeQueryScorer(opts.about)] : [];
  if (config.ranking.cochange) {
    const seeds = coChangeSeeds(config, opts, selection);
    if (seeds.length > 0) scorers.push(makeCoChangeScorer(seeds));
  }
  return scorers;
}

/** Target files in pack order, plus how many of the front are seeds (plan §4.5). */
function targetFiles(config: CtxConfig, opts: PackOptions): { files: string[]; seedCount: number } {
  const selection = select(config, {
    module: opts.module,
    about: opts.about,
    diff: opts.diff,
  });
  // `--about` re-ranks the same candidates rather than filtering them
  // (core/select.ts), so the query is applied here as a Scorer (plan §4.4,
  // §8-B.2 seam). With no query this array is empty and `rankFiles` takes
  // exactly the path it always did — no regression.
  const scorers = assembleScorers(config, opts, selection);
  // Budget cuts drop the tail, so order by importance, not alphabet.
  const ranked = rankFiles(config, { files: selection.files, scorers }).map((e) => e.rel);
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
  const notes: string[] = [];

  // --about and --diff only shape the target-files section. On a profile
  // that never includes one they change nothing at all, and silently doing
  // nothing is the worst possible answer to an explicit request.
  if (!profile.inject.includes("target-files")) {
    for (const [flag, value] of [["--about", opts.about], ["--diff", opts.diff]] as const) {
      if (value !== undefined) {
        notes.push(
          `${flag} has no effect on profile "${opts.profile}": it selects target files, ` +
            `and this profile injects ${profile.inject.join(", ")} only. Use a profile ` +
            `with target-files (e.g. light).`,
        );
      }
    }
  }

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
          // Co-change reach (plan §4.7): files outside the module that
          // change together with it in git history. The canonical case is a
          // model and the migration that creates its table, which share no
          // text at all; verified on a real repository (see report) that a
          // file with genuinely zero textual overlap can still be the
          // strongest hit. Worded as "not in the list above" rather than "no
          // static reference exists" — measured on that same repository, a
          // caller that imports the module heavily can co-change its way in
          // here too, precisely because the list above ranks *global*
          // reference centrality, not reference density with this module.
          // Silently absent when co-change is off, unavailable (shallow
          // history), or finds nothing outside the module.
          if (config.ranking.cochange) {
            const cochange = coChangeOutsideModule(config, own, [...own], COCHANGE_ELSEWHERE_FILES).map(
              (e) => `- ${e.rel}`,
            );
            if (cochange.length > 0) {
              map +=
                `\n### Changes together with this module (git history; not ` +
                `in the list above)\n${cochange.join("\n")}\n`;
            }
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
  return { content: out, tokens: approxTokens(out), relOutPath, notes };
}

export interface ExplainRow {
  rel: string;
  /** Cross-file reference score, before any scorer is applied. */
  referenceScore: number;
  /** Combined scorer contribution — query and co-change (0 with neither). */
  queryScore: number;
  /**
   * Multiplier applied after every signal; 0.2 for test paths, else 1.
   * Shown because without it a demoted row's numbers look like they do not
   * add up, which is how an explanation loses the reader's trust.
   */
  demotion: number;
  /** `(referenceScore + queryScore) * demotion` — what `targetFiles` sorts by. */
  finalScore: number;
  /** Whether the file's body made it into the pack's Target Files section. */
  included: boolean;
}

/**
 * Score breakdown for `pack --about ... --explain` (plan §4.4): once a
 * second scorer exists (co-change, §4.7) there is no other way to see why a
 * file did or didn't make the cut. This recomputes the exact contributions
 * `targetFiles` uses — same `select()` call, same `makeQueryScorer` — rather
 * than approximating them, so the table never drifts from the real ranking.
 *
 * Lives here (not in `scorers/query.ts`, which stream B otherwise owns
 * exclusively) because it needs `buildPack` itself to see which files
 * survived the token budget, and `scorers/query.ts` importing back from
 * `pack.ts` — which already imports `makeQueryScorer` from it — would make
 * the two files a circular module dependency.
 */
export function explainPack(config: CtxConfig, opts: PackOptions): ExplainRow[] {
  const selection = select(config, { module: opts.module, about: opts.about, diff: opts.diff });
  const scorers = assembleScorers(config, opts, selection);

  // Read the breakdown the ranker recorded. Recomputing it here is how this
  // table went wrong three times; `parts` exists so it cannot happen again.
  const ranked = rankFiles(config, { files: selection.files, scorers });
  const pack = buildPack(config, opts);
  const targetSection = pack.content.split("## Target Files")[1] ?? "";
  const included = new Set([...targetSection.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim()));

  return ranked.slice(0, 20).map((e) => ({
    rel: e.rel,
    referenceScore: e.parts.reference,
    queryScore: e.parts.scorers,
    demotion: e.parts.demotion,
    finalScore: e.score,
    included: included.has(e.rel),
  }));
}

