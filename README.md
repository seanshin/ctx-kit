# ctx-kit

[![npm](https://img.shields.io/npm/v/%40seanshin%2Fctx-kit)](https://www.npmjs.com/package/@seanshin/ctx-kit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

**A tool-neutral codebase context kit for AI coding agents — from frontier models to small local LLMs.**

One source of project context, served in the form each model tier can
actually use: as an MCP server for agentic tools, as a CLI for terminals and
CI, and as plain files for everything else.

한국어: [README.ko.md](README.ko.md) · 백서: [WHITEPAPER.ko.md](docs/WHITEPAPER.ko.md) · Whitepaper: [WHITEPAPER.md](docs/WHITEPAPER.md)

**Contents** — **[Usage](#usage)**: [install](#install) · [set up](#step-1-set-up-a-repository) · [verify](#step-2-verify-the-two-drafts) · [generate](#step-3-generate-the-artifacts) · [connect](#step-4-connect-your-ai-tools) · [feed a local model](#step-5-feed-a-model-that-has-no-tools) · [commands](#command-summary) · [day-to-day](#day-to-day) — **[Background](#background)**: [why](#why) · [how it works](#how-it-works) — **[Reference](#reference)**: [CLI](#cli-reference) · [config](#configuration-reference) · [MCP tools](#mcp-tool-reference) · [profiles](#profiles-serving-each-model-tier) · [per-environment](#per-environment-setup) · [local LLMs](#working-with-small-local-llms) · [cross-repo](#cross-repo-rollout) · [results](#measured-results) · [FAQ](#faq) · [design notes](#design-notes) · [license](#license-posture)

---

# Usage

## Install

Requires Node ≥ 20. The package ships `dist/` and `templates/` only (~21 KB).

```sh
npm i -g @seanshin/ctx-kit      # global install — the binary is `ctxkit`
npx -y @seanshin/ctx-kit <cmd>  # or run without installing anything
npm i -D @seanshin/ctx-kit      # or as a project dev dependency
```

## Step 1: Set up a repository

```sh
cd your-project
ctxkit init --auto --hooks
```

| Created | Purpose |
|---|---|
| `AGENTS.md` | Rules draft. Build/test commands are **auto-detected** from `package.json`, `pytest.ini`/`pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile` |
| `context.config.yaml` | Module boundaries (auto-detected from source layout) + consumption profiles |
| `docs/context/`, `docs/generated/packs/` | Where module docs and generated artifacts live |
| `.git/hooks/pre-commit` | (`--hooks`) runs `ctxkit check` at commit time — the free alternative to CI |

Existing `AGENTS.md` / `CLAUDE.md` files are **never overwritten** — they are
reported as skipped. Add `--ci` if you also want a GitHub Actions workflow
(consumes Actions minutes on private repos; `--hooks` covers the same gate for
free).

## Step 2: Verify the two drafts

The only manual step, and the one that decides quality:

1. **`AGENTS.md`** — confirm the detected commands actually run, then add what
   code cannot tell an agent: architecture decisions, constraints ("never
   inline discount rates", "don't touch `legacy/`"), and a domain glossary.
   Keep it under 150 lines; `ctxkit check` fails past that, because verbose
   rule files measurably degrade agent performance.
2. **`context.config.yaml`** — adjust module boundaries to how your team
   actually thinks about the codebase, and add noise paths (vendored code,
   migrations, fixtures) to `exclude`.

## Step 3: Generate the artifacts

```sh
ctxkit map                     # → docs/generated/repomap.md
ctxkit pack --profile light    # → docs/generated/packs/all-light.md
ctxkit sync                    # AGENTS.md → CLAUDE.md, .cursorrules, …
ctxkit check                   # gate: rules, sync, staleness, secrets
```

## Step 4: Connect your AI tools

Agentic tools (Claude Code, Codex CLI, Cursor) — register the MCP server once:

```json
{ "mcpServers": { "ctxkit": { "command": "npx", "args": ["-y", "@seanshin/ctx-kit", "serve"] } } }
```

`.mcp.json` for Claude Code, `mcp_servers` in `config.toml` for Codex CLI.
`AGENTS.md` (and the `CLAUDE.md` produced by `sync`) is picked up natively by
those tools with no configuration at all.

## Step 5: Feed a model that has no tools

```sh
ctxkit pack --profile light --module risk --stdout > /tmp/ctx.md
ollama run qwen3:14b "$(cat /tmp/ctx.md)

Using only the context above: what is the default retry interval?"
```

Or `ctxkit get <query>` for just the relevant sections, or simply paste
`docs/generated/packs/<module>-light.md` into any chat window.

## Command summary

| Command | What it does | Produces |
|---|---|---|
| `ctxkit init [--auto] [--hooks] [--ci]` | Scaffold a repository | `AGENTS.md`, `context.config.yaml`, dirs, hook |
| `ctxkit map [-b <tokens>]` | Rank files by cross-file references, outline their symbols | `docs/generated/repomap.md` |
| `ctxkit pack [-p <profile>] [-m <module>] [-a <query>] [-d <range>]` | Assemble a context pack within a token budget, optionally shaped by a task or a diff | `docs/generated/packs/…md` |
| `ctxkit sync [--link] [--force]` | Distribute rules from the single source | `CLAUDE.md`, `.cursorrules`, … |
| `ctxkit check [--run-commands] [--update-baseline]` | Gate: rules, sync, staleness, secrets, **plus repository health** | exit 0/1 |
| `ctxkit get <query>` | Print matching context sections | stdout |
| `ctxkit eval [--dry-run]` | Measure context profiles against a task file; `--dry-run` is free | results table |
| `ctxkit serve` | Run the MCP server (stdio) | 5 tools |

Every command takes `--stdout` where output is a document, and `-C <path>` to
run against another repository. Full flag-by-flag detail is in the
[CLI reference](#cli-reference) below.

## Day-to-day

| When | Run |
|---|---|
| Code changed | `ctxkit map` (the hook/CI warns when the map is stale) |
| Rules changed | edit `AGENTS.md`, then `ctxkit sync` — never edit `CLAUDE.md` directly |
| Before committing | nothing: the pre-commit hook runs `ctxkit check` |
| Handing work to a weaker model | `ctxkit pack --profile light --about "<the task>"` |
| Reviewing a change | `ctxkit pack --diff --staged` |
| Choosing a profile with evidence | `ctxkit eval --dry-run` (no model calls, no cost) |
| Onboarding another repo | `ctxkit -C /path/to/repo init --auto --hooks` |

The 10-minute onboarding checklist is [docs/onboarding.md](docs/onboarding.md).

---

# Background

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

---

# Reference

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
`inject` list. Three budget rules keep the pack useful at scale:

- The embedded map is capped at ⅓ of the pack budget (max 4000) so it can
  never starve file contents.
- With `--module`, the embedded map is **scoped to that module** rather than
  the whole repository, plus a paths-only index of the most-referenced files
  elsewhere. Measured trade-off: a module pack cannot say *where an outside
  symbol is defined* (the index carries paths, not outlines) — send those
  questions to `search_symbol`, or drop `--module`. In exchange the module's
  own files get the budget: on a production module, 4 unrelated files left
  the map and included source files went from 4 to 13.
- Target files are emitted in reference-rank order, and a file too large to
  fit is skipped rather than ending the section — one oversized file in the
  middle of the ranking must not forfeit the budget for the smaller files
  behind it. Skipped files are reported as a count.
`--repomix` delegates to the external [Repomix](https://github.com/yamadashy/repomix)
CLI when installed, falling back to the internal packer otherwise.

**Shaping the pack.** Two flags change *which* files are chosen, not just how
many fit:

```sh
ctxkit pack --about "gold tier discount rounding"   # rank by task relevance (BM25)
ctxkit pack --diff --staged                          # center on the change under review
ctxkit pack --about "…" --explain                    # why each file placed where it did
```

`--about` scores every file with BM25 over three fields — path (weight 3),
symbol names (2) and body (1) — and adds it to the reference ranking. CJK text
is indexed as character bigrams, so a Korean query survives particle changes
(할인율을 still matches 할인율). There is no English stemming, so "secret" does
not match the identifier `secrets`; use the word that appears in the code.

`--diff` takes a git range or `--staged`. The changed files are *seeds*: they
are never dropped for budget reasons, and if they alone exceed the budget the
section degrades to a seed path list plus the top-ranked seed's contents.

### `ctxkit eval [--init] [--dry-run] [--tasks <file>] …`

Measures whether a profile actually carries what a task needs. Task files are
YAML (`id`, `question`, `expect` keywords, `expect_file`); `--init` writes a
template.

```sh
ctxkit eval --init
ctxkit eval --dry-run                       # free: no model is called
ctxkit eval --profiles mid,light --models haiku,sonnet --out results.md
```

`--dry-run` reports two inclusion rates per profile, and the distinction
matters: `outline_hit` is whether the answering file reached the repository
map (enough for "where is X?"), `content_hit` whether its source reached the
pack (needed for "what is this default value?"). A `mid` profile scoring
100% outline and 0% content is behaving exactly as designed. Runs that call
models print the planned call count and ask before spending anything.

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
| `constraint` | fail | a rule from `constraints:` is broken — a symbol defined outside its allowed paths, a forbidden import, a forbidden pattern |
| `duplicate` | warn | the same top-level function defined identically in two files |
| `orphan` | warn | a source file nothing else references (abstains on files with no extractable symbols) |
| `coverage` | warn | a source file belonging to no module |
| `rot-path` | warn | `AGENTS.md` names a path that does not exist |
| `rot-command` | warn | a documented command's runner is not on `PATH` |
| `rot-module` | fail | a module glob matches zero files |

The last seven are the repository-health half: the gate checks the code the
rules describe, not only the rules. Adopt them on an existing codebase with
`ctxkit check --update-baseline`, which records today's violations so only
*new* ones fail.

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
and replaceable by a real tokenizer behind the same interface. Note that it
**underestimates CJK text** (Korean, Japanese, Chinese comments cost closer to
one token per character), so leave headroom or lower the budget for codebases
with substantial CJK content.

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
- [**Plan v2.3**](docs/plan-v2.md) (KO) — task-shaped context, repository health, and a parallel-execution plan (seams, work streams, merge order)
- [References](docs/references.md) (KO) — annotated bibliography: papers, tools, licenses, and what each informs
- [Context architecture plan](docs/ai-context-plan.md) (KO) · [Package architecture](docs/package-architecture.md) (KO) — v1, with outcomes recorded
- [Measurements](eval/findings.md) (KO)

MIT © 2026 Hyounmouk Shin
