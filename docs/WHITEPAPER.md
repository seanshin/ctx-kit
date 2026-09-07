# ctx-kit: Capability-Tiered Codebase Context for AI Coding Agents

*Whitepaper · v0.2.0 · September 2026 · [한국어판](WHITEPAPER.ko.md)*

**Contents** — [1 Abstract](#1-abstract) · [2 Problem](#2-problem) ·
[3 Principles](#3-design-principles) · [4 Architecture](#4-architecture) ·
[5 Algorithms](#5-algorithms) · [6 Evaluation](#6-evaluation) ·
[7 Field lessons](#7-what-a-real-repository-taught-us) ·
[8 Cost & safety](#8-cost-and-safety-posture) · [9 Licensing](#9-license-posture) ·
[10 Related work](#10-related-work) · [11 Limitations](#11-limitations-and-roadmap) ·
[Appendices](#appendix-a-pack-assembly-pseudocode)

## 1. Abstract

Repositories developed with AI assistance are consumed by models of very
different capability: frontier agents that explore with tools, mid-size models
with 32–128K context windows, and small local LLMs that receive a single
pasted prompt. Tooling that assumes one consumption style fails the others.

ctx-kit maintains one source of project context and derives, from it, the form
each model tier can use, exposed through three interfaces (MCP server, CLI,
plain files). In controlled measurements on a synthetic fixture and on a
308-file production repository, task success was determined by **context form
rather than model grade**: implementation-detail tasks failed on every model
tier without file contents and passed on every tier with them. In a
complementary live-agent trial, a frontier agent answered the same questions
with two targeted MCP calls in 9.3 seconds and no bulk context at all —
evidence that the tiering, not a single "best" context blob, is what makes a
codebase legible to a heterogeneous fleet of models.

## 2. Problem

### 2.1 Model heterogeneity is permanent

Cost, privacy and latency guarantee that small local models will keep being
used alongside frontier agents on the same codebase. These consumers differ
not by degree but in kind:

| Consumer | Interaction model | Failure mode when mis-served |
|---|---|---|
| Frontier agent | many turns, tool calls | context bloat: pays for tokens it would have fetched on demand |
| Mid-size model | single load, weak tool use | structural blindness: knows names, not contents |
| Small local LLM | one pasted prompt | truncation: the needed file was cut, silently |
| Human in a chat window | copy-paste | no artifact exists to paste |

### 2.2 Context files are being written badly at scale

A published evaluation of LLM-generated agent-instruction files across 138
repositories found they *reduced* agent task success while raising inference
cost by over 20%. The failure is not the convention but the content: generated
rule files restate what a linter enforces, list files the agent can see, and
bury the two or three facts that actually matter. Any system that automates
rule authoring must therefore constrain length and restrict content to what
code cannot express.

### 2.3 Tool lock-in is avoidable

The AGENTS.md convention — donated to the Linux Foundation and read natively
by Claude Code, Codex CLI, Cursor, Aider, Copilot, Gemini CLI and Windsurf —
and the Model Context Protocol together make a vendor-neutral design
practical. Neutrality is not idealism here: it is what allows one repository
to serve the fleet described in §2.1 without maintaining N copies of the truth.

## 3. Design principles

1. **Single source of truth.** Rules live in `AGENTS.md`; per-tool files are
   generated copies or symlinks, marked as generated. A file ctx-kit did not
   generate is never overwritten without an explicit `--force`.
2. **Write only what code cannot tell.** Commands, constraints, invariants,
   glossary. A 150-line cap is enforced by the gate, not by convention.
3. **Human-authored and derived artifacts are strictly separated.** Maps and
   packs are regenerated from code and never hand-edited; the gate flags
   staleness so the two never silently diverge.
4. **Capability profiles.** One declaration per model tier states which
   sections to inject and under what token budget, so serving a new tier is a
   config change, not a code change.
5. **Files are the floor.** Every feature leaves a plain-file artifact. An
   environment with no MCP and no CLI — including a person pasting into a chat
   window — is still served.
6. **Reduced-capability core.** Everything works with zero external tools
   installed; external integrations are opt-in accelerators, never
   dependencies.

## 4. Architecture

### 4.1 Four context tiers

| Tier | Content | Producer | Refresh | Typical cost |
|---|---|---|---|---|
| 0 | `AGENTS.md`: operating rules | human | on change | 200–600 tok |
| 1 | Repository map: ranked files + symbol outlines | generated | per commit/CI | 2–8K tok |
| 2 | Module docs + module packs | human + generated | as needed | 5–45K tok |
| 3 | Symbol search (definitions + references) | live | real time | 100–800 tok/query |

The tiers are ordered by the ratio of information to tokens. A frontier agent
should live in Tiers 0 and 3; a small local model can only be served by Tier 2.

### 4.2 Consumption profiles

```yaml
profiles:
  frontier: { inject: [agents], budget: 4000 }
  mid:      { inject: [agents, repomap], budget: 24000 }
  light:    { inject: [agents-summary, repomap, target-files], budget: 12000 }
```

`light` packs place rules at the front and repeat a condensed reminder at the
back. This is a deliberate response to the well-documented "lost in the
middle" recall pattern of long-context models: the two positions with the
highest recall are the head and the tail of the prompt, so the constraint most
likely to be violated is placed in both.

### 4.3 Three interfaces over one core

```
        ┌─────────────────────────────────────────────┐
        │  A. MCP server (stdio)  — 5 tools           │  agentic clients
        ├─────────────────────────────────────────────┤
        │  B. CLI                 — 7 commands        │  terminals, hooks, CI
        ├─────────────────────────────────────────────┤
        │  C. Files               — docs/generated/   │  everything else
        └─────────────────────────────────────────────┘
                        │
                   shared core
     config · walk · rank · pack · sync · check · detect
```

Interface A exposes `get_rules`, `get_repomap`, `get_module_context`,
`search_symbol` and `make_pack`. `make_pack` deserves note: it lets a frontier
agent prepare context *for a weaker model* without leaving its session, which
is the hand-off that makes a mixed fleet practical.

## 5. Algorithms

### 5.1 Symbol extraction

Per-language regular-expression outlines extract definitions (kind, name,
signature, line) for TypeScript/JavaScript, Python, Go, Rust, JVM-family
languages, Ruby, PHP, Swift and C/C++, capped at 50 symbols per file. This is
deliberately shallower than a parser: it is dependency-free, runs offline, and
sits behind an interface a tree-sitter adapter can replace without touching
the ranking or packing code. Semantic-grade analysis is explicitly delegated
to Serena (§9), and `search_symbol`'s own tool description tells agents so.

### 5.2 Repository-map ranking

The map answers "what should I look at first?" — which requires importance,
not alphabetical order. ctx-kit scores each file by how often the symbols it
defines are referenced from *other* files, a dependency-free simplification of
aider's tree-sitter + PageRank approach (algorithm inspiration only; no code
reuse — aider is Apache-2.0):

```
for each file F with symbols S(F):
    for each symbol s in S(F):
        skip if len(s.name) < 4 or s.name is a common word   # main, data, get…
        for each other file G:
            score(F) += min(count of word-boundary matches of s in G, 20)
    score(F) += min(|S(F)|, 10) * 0.5                        # capped self-weight
    if F is a test path: score(F) *= 0.2                     # production first
sort by score desc, emit outlines until the token budget is exhausted
```

Three guards, each earned from a real-repository failure (§7): the match cap
per file prevents one popular helper from dominating; the capped self-weight
prevents "many small definitions" from outranking "one heavily used symbol";
and the test demotion prevents shared fixtures — referenced by every test in
the suite — from occupying the entire budget.

### 5.3 Pack assembly

Packs are assembled section by section in the profile's declared order, with
two invariants that only reveal their necessity at scale:

- **Embedded sections get a bounded share.** The repo map is capped at
  ⅓ of the pack budget (max 4000 tokens), whether freshly built or read from
  cache. Without this, a cached 8K map inside a 12K pack leaves nothing for
  source.
- **Order what the budget will cut.** Target files are emitted in
  reference-rank order, so truncation removes the least-referenced files
  rather than whichever names sort last.

Full pseudocode is in [Appendix A](#appendix-a-pack-assembly-pseudocode).

### 5.4 Rule distribution and gating

`sync` writes per-tool files with a generated-by marker and refuses to
overwrite unmarked files (exit 1 with instructions) — the mechanism that makes
"single source of truth" safe to run in a repository that already has a
hand-written `CLAUDE.md`. `check` then enforces four invariants: rule length,
sync freshness, map staleness (mtime-based, hence a warning: git checkouts do
not preserve mtimes), and a secret scan over every artifact destined for an
LLM.

## 6. Evaluation

### 6.1 Methodology

Each measurement is a (profile × model × task) cell. For each cell the harness
builds the context with `ctxkit pack --stdout`, pipes `context + question` to
a model command reading stdin, and grades by expected-keyword match. Model
processes run in an **empty temporary directory**, so a model with file tools
cannot read the repository and bypass the supplied context — without this the
experiment measures nothing. Tasks are chosen to discriminate between
profiles: one answerable from structure alone, one requiring file contents,
one probing rules or call structure.

The harness (`eval/run.mjs`) accepts any stdin-reading command, including
`ollama run <model>`, and any repository and task file, so a team can rerun
the same matrix on their own codebase.

### 6.2 Results

**Rounds 1 and 2** — synthetic fixture, then a 308-file production repository.
Pass rate over three tasks:

| Profile | small model | larger model | context size (round 2) |
|---|---|---|---|
| `mid` (rules + map) | 2/3 | 2/3 | ~4.3K tok |
| `light` (+ ranked file contents) | **3/3** | **3/3** | ~8.7K tok |

The failing cell was always the implementation-detail question, on *both*
model tiers; both tiers passed it once file contents were present. The
practical conclusion is the inverse of the usual instinct: when a weak model
fails a codebase question, the first lever is not a stronger model but a
better-formed context. Notably, both models answered "the context does not
contain this" instead of fabricating a value — the profile boundary produced
an honest refusal rather than a hallucination.

**Round 3** — live agent session on the production repository, file-reading
tools disabled, ctx-kit MCP the only source. Three questions (a command, a
file+default-value pair, a project rule) answered **3/3 correctly in 4 turns
and 9.3 seconds**, using `get_rules` and a single `search_symbol` call. The
frontier profile — minimal standing rules plus on-demand retrieval — consumed
a small fraction of any pack's tokens. A side effect worth recording: because
`search_symbol` returns reference lines alongside definitions, the parameter's
default value appeared in the output without opening the file.

### 6.3 A caution the data produced

In Round 1 both models answered a call-graph question correctly from the map
alone, although the map contains no call information: they inferred it from
signatures and naming. That is name-quality luck, not capability, and it would
fail silently in a codebase with weaker naming. Call-graph questions belong to
Tier 3, and the finding is recorded as a usage constraint rather than a
success.

## 7. What a real repository taught us

Onboarding a 308-file production repository (Python backend, TypeScript
frontend, ~200 tracked source files after exclusions) surfaced three defects
that the synthetic fixture had hidden. Each became a rule in §5 and a test:

1. **Shared fixtures dominated the ranking.** `conftest.py` and test modules
   are referenced by every test in the suite, so the map's top slots — the
   most valuable tokens in the artifact — went to test scaffolding. An agent
   orienting in a codebase needs production code first. *Fix: demote test
   paths ×0.2, cap self-definition weight.*
2. **A cached map starved the pack.** An 8K-token cached map pasted whole into
   a 12K-token pack left no room for source, and the very file the task needed
   never appeared. *Fix: cap every embedded section at a share of the budget.*
3. **Truncation fell on the wrong files.** Target files were emitted
   alphabetically, so `pdm.py` was dropped while less-referenced files
   survived. *Fix: emit in reference-rank order so the cut lands on the least
   important files.*

The generalizable lesson is that synthetic fixtures validate *correctness*
while real repositories validate *proportion*. Every one of these defects was
invisible at fixture scale because nothing was ever near a budget boundary.

## 8. Cost and safety posture

- **No paid infrastructure required.** `init --hooks` installs a git
  pre-commit hook running the same gate as CI, locally and free. The GitHub
  Actions workflow is opt-in and explicitly labeled as consuming Actions
  minutes on private repositories.
- **Secret scanning where it matters.** `check` scans rules, module docs and
  generated packs for private-key blocks, cloud access keys, token-shaped
  strings and `api_key = "…"`-shaped assignments. These artifacts are exactly
  the ones pasted into external services, which makes them the highest-value
  place to scan and an easy one to forget.
- **Non-destructive by construction.** `sync` refuses unmarked files; `init`
  skips existing ones; no command deletes.
- **Local only.** ctx-kit makes no network calls.

## 9. License posture

ctx-kit is MIT. External tools are integrated by CLI invocation only, never
code reuse (adapter pattern), which keeps the license boundary mechanical
rather than a matter of interpretation:

| Tool | License | Integration |
|---|---|---|
| [Repomix](https://github.com/yamadashy/repomix) | MIT | optional packer, invoked as CLI |
| [Serena](https://github.com/oraios/serena) | MIT | registered *alongside* as Tier 3; not wrapped |
| [aider](https://aider.chat/docs/repomap.html) | Apache-2.0 | algorithm reference only; no code |
| universal-ctags | GPL | excluded |

Placing Serena beside ctx-kit rather than behind it is both a licensing and an
architectural choice: two MCP servers compose in every client that speaks the
protocol, so wrapping would add a client implementation for no benefit.

## 10. Related work

**AGENTS.md** (Linux Foundation) standardizes the rule file this project
treats as its source of truth. **aider** pioneered ranked repository maps with
tree-sitter and PageRank; ctx-kit reimplements a simplified ranking
independently. **Repomix** and **code2prompt** (both MIT) pack repositories
into single prompts — complementary, and Repomix is supported as an optional
backend. **Serena** (MIT) provides LSP-grade semantic retrieval over MCP and
covers the semantic end ctx-kit's outline extractor deliberately does not.
**Ruler** and similar tools distribute rules to many assistants; ctx-kit
implements the common subset internally with zero dependencies, keeping the
adapter slot open.

What is new here is not any single component but the composition: capability
profiles as a first-class config object, three interfaces over one core with
files as the guaranteed floor, and an evaluation harness that makes the
profile choice an empirical question rather than a matter of taste.

## 11. Limitations and roadmap

- **Proxy models.** The "small model" tier was measured with a small API model
  as a proxy; a true local-LLM round (`--custom "ollama run …"`) is pending a
  local installation. The harness already supports it.
- **Lexical, not semantic, references.** Reference counting is word-boundary
  matching, so a symbol name colliding with a common word inflates a score;
  short and common names are filtered, but the heuristic remains lexical.
- **Outline-grade symbols.** Regex extraction misses nested and dynamically
  defined constructs. The adapter slot for tree-sitter exists.
- **Approximate tokens.** `chars/4` is adequate for budgeting but not exact;
  a tokenizer adapter would tighten budget boundaries.
- **Single production onboarding.** One repository, one language pair. A
  second onboarding — migrating a large hand-written rule file into the
  AGENTS.md flow — is planned.

Roadmap: module-scoped maps, tokenizer-accurate budgets, a true local-LLM
measurement round, and per-repo task suites contributed alongside onboardings.

---

## Appendix A: pack assembly pseudocode

```
build_pack(config, profile, module?):
    budget    ← profile.budget
    out       ← header(profile, module, budget)
    reminder  ← ""

    for section in profile.inject:
        case "agents":          out += full AGENTS.md
        case "agents-summary":  out += first 40 lines of AGENTS.md
                                reminder ← first 12 lines        # appended at the tail
        case "repomap":
            cap ← min(budget / 3, 4000)
            map ← cached map if tokens(cached) ≤ cap else build_map(cap)
            out += map
        case "target-files":
            files ← rank_files(module ? glob(module) : all sources)
            reserve ← tokens(reminder) + 50
            for f in files:
                block ← "### {path}\n```{lang}\n{contents}\n```"
                if tokens(out + block) + reserve > budget:
                    out += "…remaining files omitted (budget N tokens)"
                    break
                out += block

    if reminder: out += "## Rule Reminder\n" + reminder
    return out, tokens(out)
```

## Appendix B: check semantics

| Check | Level | Condition | Rationale |
|---|---|---|---|
| `agents-length` | fail | missing, or > 150 lines | verbose rules measurably degrade agents (§2.2) |
| `sync` | fail | per-tool file ≠ `AGENTS.md` | silent divergence defeats the SSOT |
| `sync` | warn | per-tool file absent | may be intentional for a given repo |
| `repomap` | warn | a source file is newer than the map | mtime is unreliable after checkout |
| `secrets` | fail | key/token/assignment patterns in rules, module docs, or packs | these artifacts leave the machine |

## Appendix C: reproducing the measurements

```sh
git clone https://github.com/seanshin/ctx-kit && cd ctx-kit
npm install && npm test

# built-in fixture
node eval/run.mjs

# your own repository, with a local model
node eval/run.mjs --fixture /path/to/repo --tasks my-tasks.yaml \
  --module <module> --custom "qwen=ollama run qwen3:14b" --out results.md
```

Task file format:

```yaml
tasks:
  - id: q2-detail
    question: "What is the default value of X? Answer with the number only."
    expect: ["180"]          # pass if any keyword appears in the answer
```

Design the set so that at least one task is answerable from structure alone
and at least one requires file contents; that contrast is what makes the
profile comparison informative.
