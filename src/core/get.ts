/**
 * `ctxkit get <query>`: pull only the relevant slices of context to stdout,
 * for shell pipes (`ctxkit get auth --stdout | llm ...`) and for
 * environments that cannot run an MCP server.
 *
 * Searches AGENTS.md, docs/context/*.md and the repomap, section by
 * section (## headings), ranked by match count.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR, type CtxConfig } from "./config.js";
import { walkFiles } from "./fs.js";
import { buildRepoMap } from "./repomap.js";
import { approxTokens } from "./tokens.js";

export interface GetOptions {
  budget?: number;
  maxSections?: number;
}

interface Section {
  source: string;
  heading: string;
  body: string;
  score: number;
}

function splitSections(source: string, text: string): Section[] {
  const parts = text.split(/^(?=## )/m);
  return parts
    .map((body) => ({
      source,
      heading: (body.match(/^## (.+)$/m)?.[1] ?? "(preamble)").trim(),
      body: body.trim(),
      score: 0,
    }))
    .filter((s) => s.body.length > 0);
}

function countMatches(haystack: string, needle: string): number {
  let count = 0;
  const lower = haystack.toLowerCase();
  const q = needle.toLowerCase();
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    count++;
    idx = lower.indexOf(q, idx + q.length);
  }
  return count;
}

export function getContext(config: CtxConfig, query: string, opts: GetOptions = {}): string {
  const budget = opts.budget ?? 4000;
  const maxSections = opts.maxSections ?? 5;

  const sections: Section[] = [];
  const agentsPath = join(config.root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    sections.push(...splitSections("AGENTS.md", readFileSync(agentsPath, "utf8")));
  }
  for (const rel of walkFiles(config.root, { include: ["docs/context/**/*.md"] })) {
    sections.push(...splitSections(rel, readFileSync(join(config.root, rel), "utf8")));
  }
  const mapPath = join(config.root, GENERATED_DIR, "repomap.md");
  const repomap = existsSync(mapPath)
    ? readFileSync(mapPath, "utf8")
    : buildRepoMap(config, { budget: 4000 });
  sections.push(...splitSections("repomap", repomap));

  for (const s of sections) {
    // Heading hits weigh more than body hits.
    s.score = countMatches(s.heading, query) * 5 + countMatches(s.body, query);
  }
  const matched = sections
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSections);

  if (matched.length === 0) {
    return `No context found for "${query}". Sources searched: AGENTS.md, docs/context/, repomap.\n`;
  }

  let out = `<!-- ctxkit:v1 get query=${JSON.stringify(query)} -->\n`;
  for (const s of matched) {
    const block = `\n<!-- from ${s.source} -->\n${s.body}\n`;
    if (approxTokens(out + block) > budget) break;
    out += block;
  }
  return out;
}
