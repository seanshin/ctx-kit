# ctx-kit

[![npm](https://img.shields.io/npm/v/%40seanshin%2Fctx-kit)](https://www.npmjs.com/package/@seanshin/ctx-kit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A tool-neutral codebase context kit for AI coding agents — from frontier models to small local LLMs.**

한국어 문서: [README.ko.md](README.ko.md) · [백서 (Korean whitepaper)](docs/WHITEPAPER.ko.md)

## The problem

AI-assisted repositories get consumed by wildly different models: a frontier
agent (Claude Code, Codex CLI) that explores with tools, a mid-size model with
a 32–128K window, and a small local LLM that gets one shot at a pasted prompt.
Most context tooling serves only one of these. ctx-kit maintains **one source
of context** and serves each model tier what it can actually use — and our
measurements show the failures you prevent this way are caused by **context
form, not model grade** (see [Measured results](#measured-results)).

## Design: four tiers, three interfaces

Context is layered by cost and freshness:

| Tier | What | Made by |
|---|---|---|
| 0 | `AGENTS.md` — rules code can't tell (commands, constraints, glossary), ≤150 lines | human |
| 1 | Repository map — files ranked by cross-file references, symbol outlines | generated |
| 2 | Per-module context docs + packs | human + generated |
| 3 | On-demand symbol search | live (MCP) |

And served through three interfaces, smartest to simplest:

1. **MCP server** (`ctxkit serve`) — `get_rules`, `get_repomap`,
   `get_module_context`, `search_symbol`, `make_pack` for agentic tools
   (Claude Code, Codex CLI, Cursor, local agents).
2. **CLI** — for terminals, git hooks, CI, shell pipes.
3. **Files** (`docs/generated/`) — the universal fallback: any environment
   that can read a file (or a human pasting into a chat window) is supported.

## Quickstart

```sh
npm i -g @seanshin/ctx-kit     # or: npx -y @seanshin/ctx-kit <cmd>

cd your-project
ctxkit init --auto             # scaffold: detects commands & module boundaries
                               #   from package.json / pytest.ini / Cargo.toml / go.mod
ctxkit map                     # ranked repo map  -> docs/generated/repomap.md
ctxkit pack --profile light    # context pack for small models -> docs/generated/packs/
ctxkit sync                    # AGENTS.md -> CLAUDE.md, .cursorrules, ... (SSOT)
ctxkit check                   # gate: rule length, sync freshness, staleness, secrets
ctxkit get <query>             # print matching context sections (pipe-friendly)
```

MCP registration (any MCP client — same pattern for Claude Code `.mcp.json`,
Codex `config.toml`, Cursor):

```json
{ "mcpServers": { "ctxkit": { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] } } }
```

Consumption profiles live in `context.config.yaml` and decide what each model
tier gets:

```yaml
profiles:
  frontier: { inject: [agents], budget: 4000 }                                 # rules only; explores via MCP
  mid:      { inject: [agents, repomap], budget: 24000 }                       # + structure map
  light:    { inject: [agents-summary, repomap, target-files], budget: 12000 } # + ranked file contents
```

## Measured results

Same three tasks, two context profiles × two model tiers, on a real 308-file
production repo (see [eval/findings.md](eval/findings.md) for all three rounds):

| | small model | larger model |
|---|---|---|
| `mid` (rules + map only) | 2/3 | 2/3 |
| `light` (+ ranked file contents) | **3/3** | **3/3** |

The implementation-detail task failed on **both** model tiers without file
contents, and passed on **both** with them: what decides success is the
context profile, not the model. Meanwhile a frontier agent given only the MCP
tools solved all three tasks in 2 targeted calls, 9.3s — no bulk context at
all. That is the tiering working as designed.

The harness is reusable: `node eval/run.mjs --fixture <repo> --tasks <yaml>`
accepts any stdin-reading model command (`--custom "qwen=ollama run qwen3:14b"`).

## Free by design

No paid infrastructure is required: `ctxkit init --hooks` installs a git
pre-commit hook that runs the same gate as CI locally. The GitHub Actions
workflow (`init --ci`) is optional and clearly marked as consuming Actions
minutes on private repos.

## License posture

MIT. External tools are integrated **by CLI invocation only, never code
reuse** (adapter pattern): [Repomix](https://github.com/yamadashy/repomix)
(MIT, optional packer), [Serena](https://github.com/oraios/serena) (MIT,
LSP-grade search — register alongside, not wrapped). The repo-map ranking is
an independent implementation inspired by
[aider's](https://aider.chat/docs/repomap.html) approach (Apache-2.0 —
algorithm reference only).

## Docs

- [Whitepaper](docs/WHITEPAPER.md) ([한국어](docs/WHITEPAPER.ko.md)) — design, algorithms, measurements
- [Onboarding playbook](docs/onboarding.md) (KO) — 10-minute checklist for a new repo
- [Context architecture plan](docs/ai-context-plan.md) (KO) · [Package architecture](docs/package-architecture.md) (KO)

## Development

```sh
npm install && npm test       # build + test suite (node --test)
```

MIT © 2026 Hyounmouk Shin
