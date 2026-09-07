# ctx-kit

[![npm](https://img.shields.io/npm/v/%40seanshin%2Fctx-kit)](https://www.npmjs.com/package/@seanshin/ctx-kit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

**A tool-neutral codebase context kit for AI coding agents — from frontier models to small local LLMs.**

One source of project context, served in the form each model tier can
actually use: as an MCP server for agentic tools, as a CLI for terminals and
CI, and as plain files for everything else.

한국어: [README.ko.md](README.ko.md) · 백서: [WHITEPAPER.ko.md](docs/WHITEPAPER.ko.md) · Whitepaper: [WHITEPAPER.md](docs/WHITEPAPER.md)

```sh
npm i -g @seanshin/ctx-kit
cd your-project && ctxkit init --auto && ctxkit map
```

---

## Table of contents

- [Why](#why) · [How it works](#how-it-works) · [Install](#install) · [Quickstart](#quickstart)
- Reference: [CLI](#cli-reference) · [Config](#configuration-reference) · [MCP tools](#mcp-tool-reference) · [Profiles](#profiles-serving-each-model-tier)
- Guides: [Per-environment setup](#per-environment-setup) · [Small local LLMs](#working-with-small-local-llms) · [Cross-repo rollout](#cross-repo-rollout)
- [Measured results](#measured-results) · [FAQ](#faq) · [Design notes](#design-notes) · [License posture](#license-posture)

---

## Why

A repository developed with AI assistance is consumed by models of very
different capability, often on the same day:

| Consumer | How it reads a codebase | What it needs |
|---|---|---|
| Frontier agent (Claude Code, Codex CLI) | explores with tools, many turns | minimal standing rules + on-demand search |
| Mid-size model (32–128K window) | one context load, limited tools | rules + a structural map |
| Small local LLM | a single pasted prompt | a pre-cut pack with actual file contents |
| A human in a chat window | copy-paste | a readable file |

Most context tooling serves exactly one of these. ctx-kit maintains one
source and derives each form from it — and the measurements below show that
what decides task success is **the context form, not the model grade**.

Two further constraints shaped the design:

- **Verbose rule files actively hurt.** A published evaluation across 138
  repositories found LLM-generated agent-instruction files *reduced* task
  success while raising inference cost by 20%+. So `AGENTS.md` is capped at
  150 lines by a gate, and `init --auto` only prefills facts it can read out
  of the repo's own manifests.
- **No vendor lock-in.** [AGENTS.md](https://agents.md) (now under the Linux
  Foundation; read natively by Claude Code, Codex CLI, Cursor, Aider, Copilot,
  Gemini CLI, Windsurf) and the Model Context Protocol make a neutral design
  practical.

## How it works

**Four tiers of context**, ordered by cost and freshness:

| Tier | What | Produced by | Refreshed |
|---|---|---|---|
| 0 | `AGENTS.md` — commands, constraints, glossary (≤150 lines) | human | on change |
| 1 | Repository map — files ranked by cross-file references, with symbol outlines | `ctxkit map` | per commit / CI |
| 2 | `docs/context/<module>.md` + per-module packs | human + `ctxkit pack` | as needed |
| 3 | Symbol search (definitions + reference sites) | `ctxkit serve` | live |

**Three interfaces over one core**, smartest to simplest:

```
┌──────────────────────────────────────────────────────────┐
│ A. MCP server   ctxkit serve      → agentic tools        │
├──────────────────────────────────────────────────────────┤
│ B. CLI          ctxkit <cmd>      → terminals, hooks, CI │
├──────────────────────────────────────────────────────────┤
│ C. Files        docs/generated/   → anything else        │
└──────────────────────────────────────────────────────────┘
```

Interface C is the floor, not an afterthought: every feature must leave a
plain-file artifact, so an environment with neither MCP nor CLI — including a
person pasting into a chat window — is still served.

## Install

```sh
npm i -g @seanshin/ctx-kit      # global; binary is `ctxkit`
npx -y @seanshin/ctx-kit <cmd>  # or run without installing
npm i -D @seanshin/ctx-kit      # or per-project dev dependency
```

Requires Node ≥ 20. The package ships `dist/` and `templates/` only (~21 KB).

## Quickstart

```sh
cd your-project

ctxkit init --auto --hooks     # scaffold + install the free commit-time gate
$EDITOR AGENTS.md              # verify the detected commands, add constraints
$EDITOR context.config.yaml    # adjust module boundaries

ctxkit map                     # docs/generated/repomap.md
ctxkit pack --profile light    # docs/generated/packs/all-light.md
ctxkit sync                    # AGENTS.md → CLAUDE.md, .cursorrules, …
ctxkit check                   # gate: rules, sync, staleness, secrets
```

`init --auto` reads `package.json`, `pytest.ini`/`pyproject.toml`,
`Cargo.toml`, `go.mod` and `Makefile` — at the repo root, in direct children,
and inside container dirs (`services/`, `apps/`, `packages/`, `crates/`, `src/`, `lib/`) — to
prefill build/test commands and module boundaries. It never overwrites an
existing `AGENTS.md` or `CLAUDE.md`.

The 10-minute checklist for a new repo is
[docs/onboarding.md](docs/onboarding.md).

---

## CLI reference

Global: `-C, --dir <path>` runs against another repository (default `.`);
`--version`, `--help`.

### `ctxkit init [--auto] [--hooks] [--ci]`

Scaffolds `context.config.yaml`, `AGENTS.md`, `docs/context/`,
`docs/generated/packs/`. Existing files are skipped, never overwritten.

| Flag | Effect |
|---|---|
| `--auto` | Detect commands + module boundaries from manifests and prefill both drafts |
| `--hooks` | Install `.git/hooks/pre-commit` running `ctxkit check` (local, free; skipped if a hook exists) |
| `--ci` | Install `.github/workflows/ctxkit.yml` (consumes Actions minutes on private repos — prefer `--hooks`) |

### `ctxkit map [-b <tokens>] [--stdout]`

Writes the ranked repository map to `docs/generated/repomap.md`
(default budget 8000 tokens). Ranking: each file scores the number of
cross-file references to the symbols it defines, plus a capped
self-definition weight; test files are demoted ×0.2 so production code
surfaces first. Files past the budget are listed as an omitted count.

### `ctxkit pack [-p <profile>] [-m <module>] [--repomix] [--stdout]`

Assembles a context pack into `docs/generated/packs/<module|all>-<profile>.md`
and prints its approximate token count. Sections follow the profile's
`inject` list; target files are emitted in reference-rank order so that a
budget cut drops the *least* referenced files, and the embedded map is capped
at ⅓ of the pack budget (max 4000) so it can never starve file contents.
`--repomix` delegates to the external [Repomix](https://github.com/yamadashy/repomix)
CLI when installed, falling back to the internal packer otherwise.

### `ctxkit sync [--link] [--force]`

Distributes `AGENTS.md` to per-tool rule files. Targets come from
`sync.targets`:

| Target | File |
|---|---|
| `claude` | `CLAUDE.md` |
| `cursor` | `.cursorrules` |
| `gemini` | `GEMINI.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `windsurf` | `.windsurfrules` |

Generated copies carry a `<!-- generated by ctxkit sync … -->` header.
A per-tool file that ctx-kit did not generate is reported as
`skipped-foreign` and the command exits 1 — merge it into `AGENTS.md` first,
or pass `--force`. `--link` creates symlinks instead of copies.

### `ctxkit check [--max-rule-lines <n>]`

The gate. Exits 1 if any check fails.

| Check | Level | What it catches |
|---|---|---|
| `agents-length` | fail | `AGENTS.md` missing, or over 150 lines |
| `sync` | fail / warn | per-tool file differs from `AGENTS.md` (stale) / not yet generated |
| `repomap` | warn | a source file is newer than `repomap.md` (mtime heuristic) |
| `secrets` | fail | private-key blocks, `AKIA…` keys, `ghp_…` tokens, `api_key = "…"`-shaped assignments in rules, module docs or generated packs |

The secret scan targets exactly the files that get pasted into external
services. Repomap staleness is a warning because git checkouts do not
preserve mtimes.

### `ctxkit get <query> [-b <tokens>] [-k <n>]`

Prints the context sections matching a query to stdout — `AGENTS.md`,
`docs/context/*.md` and the repo map are split on `##` headings and ranked
(heading hits weigh 5×). Built for pipes:

```sh
ctxkit get billing | llm -m local-model "Where is tax computed?"
ctxkit get auth --budget 2000 | pbcopy
```

### `ctxkit serve`

Runs the MCP server over stdio. Protocol on stdout, logs on stderr.

---

## Configuration reference

`context.config.yaml` is the only ctx-kit file that lives in a target repo —
all logic stays in the package.

```yaml
version: 1                     # schema version; mismatches are rejected

modules:                       # Tier 2 boundaries: name → globs (repo-relative)
  risk:    ["src/risk/**"]
  web:     ["web/src/**"]

exclude:                       # extra ignores, on top of the built-ins
  - "**/generated/**"

profiles:                      # what each model tier receives
  frontier: { inject: [agents], budget: 4000 }
  mid:      { inject: [agents, repomap], budget: 24000 }
  light:    { inject: [agents-summary, repomap, target-files], budget: 12000 }
  light-xl: { inject: [agents-summary, repomap, target-files], budget: 45000 }

sync:
  targets: [claude, cursor]    # see the sync table above
```

**`inject` sections**

| Section | Contents |
|---|---|
| `agents` | full `AGENTS.md` |
| `agents-summary` | first 40 lines, plus a 12-line reminder appended at the *end* of the pack |
| `repomap` | the ranked map (cached if fresh and within cap, else regenerated) |
| `target-files` | file contents, reference-ranked, truncated at the budget |

The `agents-summary` + tail-reminder arrangement exists because models recall
the start and end of a long prompt far better than the middle.

**Always ignored** (no configuration needed): dot-entries (`.git`, `.venv`,
`.next`, …), `node_modules`, `dist`, `build`, `out`, `target`, `vendor`,
`__pycache__`, `venv`, `.cache`, `coverage`, files over 512 KiB, and binaries.

**Languages recognized for symbol extraction**: TypeScript/TSX, JavaScript/JSX,
Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP, Swift, C/C++.

Token counts are a `chars/4` approximation — accurate enough for budgeting,
and replaceable by a real tokenizer behind the same interface.

## MCP tool reference

```json
{ "mcpServers": { "ctxkit": { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] } } }
```

| Tool | Parameters | Returns |
|---|---|---|
| `get_rules` | — | `AGENTS.md` |
| `get_repomap` | `budget?` (500–50000) | ranked map with symbol outlines |
| `get_module_context` | `module`, `profile?` | `docs/context/<module>.md` + that module's pack |
| `search_symbol` | `name`, `include_references?` | definition sites (exact, then substring) + up to 30 reference lines |
| `make_pack` | `profile?`, `module?` | writes a pack file, returns its path and token count |

`make_pack` is the hand-off tool: a frontier agent can prepare context for a
weaker model without leaving its session. `search_symbol` is outline-based;
for LSP-grade analysis register [Serena](https://github.com/oraios/serena)
*alongside* ctx-kit — its tool description tells agents to do exactly that.

## Profiles: serving each model tier

| Profile | Injects | Typical budget | For |
|---|---|---|---|
| `frontier` | rules only | 4K | tool-using agents that explore via MCP |
| `mid` | rules + map | 24K | mid-size models, structure questions |
| `light` | rule summary + map + ranked file contents + reminder | 12K | small local LLMs, one-shot prompts |
| `light-xl` | same as `light` | 45K | 128K-class local models needing a whole module |

Rule of thumb from the measurements: **structure questions** ("where is X
defined?") are answered by the map alone, at a fraction of the tokens.
**Implementation-detail questions** ("what is this default value?") require
file contents on *every* model tier. **Call-graph questions** should go to
`search_symbol`, not the map — see the caution in
[eval/findings.md](eval/findings.md).

---

## Per-environment setup

| Environment | Setup |
|---|---|
| **Claude Code** | `.mcp.json` with the snippet above; `AGENTS.md` is read natively; `ctxkit init --hooks` adds the commit gate |
| **Codex CLI** | same server under `mcp_servers` in `config.toml` |
| **Cursor / Windsurf** | MCP setting + `ctxkit sync` generates `.cursorrules` / `.windsurfrules` |
| **aider** | file interface: `aider --read docs/generated/repomap.md` |
| **Local agent (OpenCode, Ollama-based)** | MCP if the model handles tools; otherwise pipe `ctxkit pack --profile light --stdout` |
| **Chat window (no tooling)** | paste `docs/generated/packs/<module>-light.md` |
| **CI** | `npx -y @seanshin/ctx-kit map && npx -y @seanshin/ctx-kit check` |
| **Any repo, no install** | `ctxkit -C /path/to/repo <cmd>` |

## Working with small local LLMs

```sh
ctxkit pack --profile light --module risk --stdout > /tmp/ctx.md
ollama run qwen3:14b "$(cat /tmp/ctx.md)

Using only the context above: what is the default retry interval?"
```

Three things the pack does for you: it puts rules first and repeats them last;
it orders file contents by reference rank so the budget cut lands on the least
important files; and it caps the embedded map so it cannot crowd out the
source you actually need. Set `num_ctx` on the Ollama side to at least the
pack's reported token count.

You can measure your own repo with the same harness the project uses:

```sh
node eval/run.mjs --fixture /path/to/repo --tasks my-tasks.yaml \
  --module risk --custom "qwen=ollama run qwen3:14b" --out results.md
```

Tasks are three-field YAML (`id`, `question`, `expect` keywords); model
processes run in an empty temp directory so they cannot read the repo and
cheat.

## Cross-repo rollout

Target repositories keep only `context.config.yaml` plus generated artifacts;
all logic stays in this package, so upgrading everyone is
`npm i -g @seanshin/ctx-kit@latest`.

```sh
for repo in ~/src/*/; do ctxkit -C "$repo" init --auto --hooks; done
```

Migrating a repo that already has a hand-written `CLAUDE.md`: move its content
into `AGENTS.md`, then `ctxkit sync --force` (plain `sync` refuses to clobber
files it did not generate).

---

## Measured results

Three tasks × two profiles × two model tiers, run on a synthetic fixture and
then on a 308-file production repository. Full data and methodology:
[eval/findings.md](eval/findings.md).

| | small model | larger model |
|---|---|---|
| `mid` (rules + map) | 2/3 | 2/3 |
| `light` (+ ranked file contents) | **3/3** | **3/3** |

The implementation-detail task failed on **both** tiers without file contents
and passed on **both** with them: the context profile decided the outcome, not
the model. Both models answered "the context does not contain this" rather
than hallucinating.

Separately, a live agent session on the same repo — file-reading tools
disabled, ctx-kit MCP only — answered all three questions correctly in **4
turns and 9.3 seconds** using just `get_rules` and one `search_symbol` call.
That is the `frontier` profile working as designed, at a fraction of any
pack's token cost.

Onboarding that production repo also caught three defects that the synthetic
fixture had hidden (test files dominating the ranking; a cached map starving
the file section; alphabetical truncation dropping the wrong files). All three
are fixed and covered by tests.

## FAQ

**Does this replace `AGENTS.md`?** No — it is built on it. ctx-kit keeps
`AGENTS.md` as the single source and generates the per-tool variants.

**Will it overwrite my `CLAUDE.md`?** Never without `--force`. Files ctx-kit
did not generate are reported and skipped.

**Do I need GitHub Actions?** No. `ctxkit init --hooks` runs the same gate at
commit time, locally and free. The workflow is opt-in and labeled.

**Why not tree-sitter?** The symbol extractor sits behind an interface a
tree-sitter adapter can replace; the regex outline keeps the package
dependency-light and works offline. Semantic-grade analysis is Serena's job.

**Is anything sent anywhere?** No. Everything runs locally; ctx-kit makes no
network calls.

**Repomap looks wrong for my layout.** Add noise paths to `exclude`, then
re-run `ctxkit map`. Vendored code, migrations and fixtures are the usual
culprits.

## Design notes

- **Adapter boundary as license boundary.** External tools are invoked as
  CLIs, never vendored, so swapping Repomix for code2prompt is a one-file
  change and the MIT posture stays mechanical.
- **Reduced-capability core.** Everything works with zero external tools
  installed — important for offline and air-gapped environments.
- **Files as the contract.** Because every command leaves a file, the weakest
  environment is always supported, and CI can diff artifacts.

Project layout:

```
src/core/      config, fs walk, tokens, repomap, pack, sync, check, get, detect
src/adapters/  symbols (own), repomix (CLI wrapper), ruler/serena (notes)
src/cli.ts     interface B      src/mcp.ts   interface A
templates/     init scaffolds, pre-commit hook, CI workflow
eval/          measurement harness, fixture, tasks, findings
test/          node --test suite
```

## Development

```sh
npm install
npm test        # builds, then runs the node --test suite (10 tests)
npm run build   # tsc only
```

Tests cover config defaults and schema rejection, ignore rules, symbol
extraction, ranking and test demotion, pack budgeting and module filtering,
sync's foreign-file protection and staleness detection, the secret scan,
auto-detection, and query retrieval.

## License posture

MIT. External tools are integrated **by CLI invocation only, never code
reuse**: [Repomix](https://github.com/yamadashy/repomix) (MIT, optional
packer), [Serena](https://github.com/oraios/serena) (MIT, LSP-grade search —
registered alongside, not wrapped). The repo-map ranking is an independent
implementation inspired by [aider's](https://aider.chat/docs/repomap.html)
tree-sitter + PageRank approach (Apache-2.0 — algorithm reference only).
GPL tools such as universal-ctags were excluded deliberately.

## Docs

- [Whitepaper](docs/WHITEPAPER.md) · [백서](docs/WHITEPAPER.ko.md) — design, algorithms, measurements
- [Onboarding playbook](docs/onboarding.md) (KO) — 10-minute checklist
- [Context architecture plan](docs/ai-context-plan.md) (KO) · [Package architecture](docs/package-architecture.md) (KO)
- [Measurements](eval/findings.md) (KO)

MIT © 2026 Hyounmouk Shin
