/**
 * ctxkit MCP server (interface A) — stdio transport.
 *
 * Exposes the same core as the CLI to any MCP client (Claude Code, Codex
 * CLI, Cursor, local agents). stdout carries the protocol; all logging
 * goes to stderr.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, type CtxConfig } from "./core/config.js";
import { VERSION } from "./core/version.js";
import { readText, walkFiles } from "./core/fs.js";
import { buildPack } from "./core/pack.js";
import { buildRepoMap } from "./core/repomap.js";
import { SOURCE_EXTENSIONS, extractSymbols } from "./adapters/symbols.js";

function text(s: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: s }] };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceFiles(config: CtxConfig): string[] {
  return walkFiles(config.root, { exclude: config.exclude }).filter((f) =>
    SOURCE_EXTENSIONS.has(extname(f)),
  );
}

export async function startMcpServer(rootDir: string): Promise<void> {
  const config = loadConfig(rootDir);
  const server = new McpServer({ name: "ctxkit", version: VERSION });

  server.registerTool(
    "get_rules",
    {
      description:
        "Project rules from AGENTS.md: build/test commands, architecture decisions, constraints, domain glossary. Read once before editing code.",
      inputSchema: {},
    },
    async () => {
      const p = join(config.root, "AGENTS.md");
      return text(
        existsSync(p) ? readFileSync(p, "utf8") : "No AGENTS.md found — run `ctxkit init` first.",
      );
    },
  );

  server.registerTool(
    "get_repomap",
    {
      description:
        "Compact repository map: files ranked by cross-file references, each with a symbol outline (name, kind, line). Use to orient in an unfamiliar codebase before opening files.",
      inputSchema: {
        budget: z
          .number()
          .int()
          .min(500)
          .max(50000)
          .optional()
          .describe("approximate token budget (default 8000)"),
      },
    },
    async ({ budget }) => text(buildRepoMap(config, { budget: budget ?? 8000 })),
  );

  server.registerTool(
    "get_module_context",
    {
      description:
        "Everything about one module: its human-written context doc (docs/context/<module>.md) plus a profile-aware pack of its files. Modules are defined in context.config.yaml.",
      inputSchema: {
        module: z.string().min(1).describe("module name from context.config.yaml"),
        profile: z.string().optional().describe("consumption profile (default: light)"),
        about: z
          .string()
          .optional()
          .describe("task description; ranks the module's files by relevance (planned: 0.4.0)"),
      },
    },
    async ({ module, profile, about }) => {
      const parts: string[] = [];
      const docPath = join(config.root, "docs/context", `${module}.md`);
      if (existsSync(docPath)) {
        parts.push(`<!-- docs/context/${module}.md -->\n${readFileSync(docPath, "utf8").trim()}`);
      }
      try {
        const pack = buildPack(config, { profile: profile ?? "light", module, about });
        parts.push(pack.content);
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
      return text(parts.join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "search_symbol",
    {
      description:
        "Find where a symbol is defined, optionally with reference sites. Outline-based (regex) fallback — for full LSP-grade search, attach the Serena MCP server alongside this one.",
      inputSchema: {
        name: z.string().min(2).describe("symbol name (exact match preferred, substring fallback)"),
        include_references: z.boolean().optional().describe("also list reference lines (default true)"),
      },
    },
    async ({ name, include_references }) => {
      const withRefs = include_references ?? true;
      const defs: string[] = [];
      const subDefs: string[] = [];
      const refs: string[] = [];
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
      for (const rel of sourceFiles(config)) {
        const content = readText(config.root, rel);
        if (content === null) continue;
        for (const s of extractSymbols(rel, content)) {
          const line = `${rel}:${s.line} ${s.kind} \`${s.name}${s.signature}\``;
          if (s.name === name) defs.push(line);
          else if (s.name.toLowerCase().includes(name.toLowerCase())) subDefs.push(line);
        }
        if (withRefs && refs.length < 30) {
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && refs.length < 30; i++) {
            if (re.test(lines[i])) refs.push(`${rel}:${i + 1} ${lines[i].trim().slice(0, 120)}`);
          }
        }
      }
      const foundDefs = defs.length > 0 ? defs : subDefs;
      if (foundDefs.length === 0 && refs.length === 0) {
        return text(`No definitions or references found for "${name}".`);
      }
      let out = `# Definitions${defs.length === 0 && subDefs.length > 0 ? " (substring matches)" : ""}\n`;
      out += foundDefs.length > 0 ? foundDefs.join("\n") : "(none)";
      if (withRefs) out += `\n\n# References (max 30)\n${refs.join("\n") || "(none)"}`;
      return text(out);
    },
  );

  server.registerTool(
    "make_pack",
    {
      description:
        "Assemble a profile-aware context pack file (rules + repomap + target files within a token budget) and return its path — for handing context to another, weaker model. Pass `about` so the pack is shaped for the task you are handing over.",
      inputSchema: {
        profile: z.string().optional().describe("consumption profile (default: light)"),
        module: z.string().optional().describe("restrict to one module from context.config.yaml"),
        about: z.string().optional().describe("task description; ranks files by relevance (planned: 0.4.0)"),
        diff: z
          .string()
          .optional()
          .describe("git revision range or '--staged'; centers the pack on changes (planned: 0.4.0)"),
      },
    },
    async ({ profile, module, about, diff }) => {
      try {
        const pack = buildPack(config, { profile: profile ?? "light", module, about, diff });
        const full = join(config.root, pack.relOutPath);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, pack.content);
        return text(`wrote ${pack.relOutPath} (~${pack.tokens} tokens)`);
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
    },
  );

  await server.connect(new StdioServerTransport());
  console.error(`ctxkit MCP server ready (root: ${config.root})`);
}
