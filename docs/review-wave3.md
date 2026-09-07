# Wave-3 adversarial review (Stream I)

Reviewed: `src/core/{pack,repomap,select,tokens,baseline,check,eval}.ts`,
`src/checks/*.ts`, `src/scorers/*.ts`, `src/select/diff.ts`,
`src/adapters/*.ts`, `src/cli.ts`, `src/mcp.ts`, against `docs/plan-v2.md`
§4.1–4.7, §6-B, §6-C, §10.

Method: read every file above in full, then built (`npm run build`), ran the
full test suite (`npm test`, 60/60 green throughout), and exercised the CLI
against four targets: this repo, a from-scratch non-git temp dir, several
purpose-built git fixtures (1-commit history, module boundaries, test-file
pollution, etc.), and read-only (`-C`, no writes) against
`/Users/hyounmoukshin/GitHub_project/twin` (308 source files — the same
reference scale plan-v2 §6-B's budget table and §4.2's filter-chain numbers
are measured against). Every finding below was reproduced with a concrete
command and, where a number is quoted, an actual measurement — none are
read-only speculation. No model/LLM calls were made at any point.

Findings are ordered by severity, high to low.

---

## 1. [Bug] `--explain`'s score breakdown is wrong whenever a test file has the highest raw reference score — a third instance of the "explain diverges from the packer" family

**Where:** `src/core/pack.ts`, `explainPack` (lines 272–301).

`explainPack` computes `baseline = rankFiles(config, { files: selection.files })`
(no scorers) to get "the raw reference score, before any scorer," then
derives its own `maxRef = Math.max(...baseline scores)` and
`shownRef(rel) = raw(rel) / maxRef` to reverse-engineer what the real,
scorer-enabled `rankFiles` call normalized by internally.

The problem: `rankFiles`'s test-file demotion
(`repomap.ts:116-118`, `entry.score *= 0.2` for `TEST_PATH_RE`) runs
**unconditionally**, whether or not scorers are present — so `baseline`'s
returned scores are *already demoted*. But when scorers **are** present
(the `actual` call), `rankFiles`'s own internal normalization
(`repomap.ts:93-109`, `entry.score /= maxRef`) runs **before** that
demotion, against the *raw, un-demoted* scores. So `explainPack`'s
`maxRef` (derived from demoted scores) and the real `maxRef` used inside
`rankFiles` for the `actual` computation (derived from raw scores) are two
different numbers whenever the single highest-raw-scoring file in the
corpus happens to be a test file — which materially changes every other
file's displayed `reference`/`query` split, not just the test file's own
row.

**Repro:** a fixture where a test file (`tests/fixture.spec.ts`) defines a
symbol referenced heavily by five sibling test files (raw ref score ≈20.5,
demoted to ≈4.1), while the real seed file (`src/seed.ts`) has a modest raw
score (≈2.5, not a test file, not demoted):
```
ctxkit pack --about "seed" --explain --stdout
```
```
file                        reference  query   final  included
src/seed.ts                 0.61       1.51    2.12   yes
src/caller.ts                0.12       0.81    0.93   yes
tests/fixture.spec.ts        1.00      -0.80    0.20   yes
```
`tests/fixture.spec.ts` is shown with `reference: 1.00` — i.e. `--explain`
reports it as *the single most cross-referenced file in the whole
corpus* — and a **negative** query contribution (`-0.80`), which is
nonsensical (BM25/query scores are non-negative by construction). `final`
(0.20) is correct — it's what the packer actually used — but the
reference/query decomposition shown to the user for tuning is not; it
implies the query actively hurt this file's ranking, which never happened.
`src/seed.ts`'s displayed `reference: 0.61` is also wrong relative to what
`rankFiles` actually used internally (hand-computed expected value ≈0.12,
using the same pre-demotion `maxRef` the real ranking used).

This is display-only — the actual pack content and ordering are unaffected,
since `buildPack`/`targetFiles` never go through this reconstruction — but
`--explain`'s entire purpose (per plan §4.4: "사용자 튜닝 수단이자 우리
자신의 디버깅 수단") is to be trustworthy for tuning, and a negative
query score actively misleads that tuning.

**Smallest fix:** have `rankFiles` compute (or `explainPack` recompute) the
normalization denominator from the same pre-demotion raw scores in both
the baseline and the actual path — e.g. capture `maxRef` before the
demotion loop inside `rankFiles` and expose it (or a pre-demotion score
map) for `explainPack` to reuse, instead of `explainPack` re-deriving its
own denominator from a differently-shaped (already-demoted) baseline call.

---

## 2. [Bug] `--about` and `--diff` are silent no-ops on the `mid` and `frontier` profiles

**Where:** `src/core/pack.ts` — the diff-range note, the seed list, and the
query/co-change scorers (`assembleScorers`, `targetFiles`) are only ever
touched inside the `case "target-files":` branch of `buildPack`'s section
loop (lines 170–233). The shipped `mid` profile is
`inject: ["agents", "repomap"]` and `frontier` is `inject: ["agents"]`
(`src/core/config.ts` `DEFAULT_PROFILES`) — neither contains
`"target-files"`. The `repomap` section itself (present in `mid`) never
receives scorers either — `RepoMapOptions` (`repomap.ts:16-22`) has no
`scorers` field, so even the map is always the plain reference ranking.

**Repro:**
```
ctxkit pack --profile mid --stdout             > a.txt
ctxkit pack --profile mid --diff HEAD --stdout > b.txt
diff a.txt b.txt   # only the two generated= timestamps differ
```
I ran this (byte-for-byte diff) against a small git-enabled fixture: the
two outputs are identical apart from timestamps. Same result for
`--profile frontier --about "..."` vs. plain `--profile frontier`.

**Observed:** the flag is silently accepted, no error, no warning, and has
*zero* effect on the pack — not even a one-line note that a diff/query was
requested but the profile doesn't support it.
**Expected:** either the flag does something visible in every profile, or
the tool tells the user it can't. A user who runs
`ctxkit pack --profile mid --diff --staged` (a very plausible request — a
smaller pack that still names what changed) gets a pack indistinguishable
from having passed nothing.

**Smallest fix:** in `buildPack`, after the section loop, if
`opts.diff !== undefined || opts.about !== undefined` and `"target-files"`
was never in `profile.inject`, emit a one-line warning. Cheaper
alternative: let the `repomap` section accept the same scorers
`targetFiles` builds, so a diff/query at least reorders the map.

---

## 3. [Bug] `--diff` silently drops `--module`, while the map section still honors it — inconsistent pack

**Where:** `src/core/select.ts:53-56` — `select()` checks
`opts.diff !== undefined` first and returns `diffSelection(...)`
unconditionally, **before** looking at `opts.module` at all. But
`src/core/pack.ts`'s `"repomap"` section (lines 137-158) branches on
`opts.module` **directly**, independent of `select()`.

**Repro** (git fixture with `modules: { modA: ["src/modA/**"] }`, a file
`src/modA/x.ts`, and a staged change to an unrelated `src/modB/y.ts`):
```
ctxkit pack --diff --staged --module modA --stdout
```
Result:
```
# Context Pack: modA (light)
## Repository Map: modA
Files: 1 source files scanned.
## src/modA/x.ts
...
## Target Files
_Diff range: `--staged`. Seeds (1 changed file): `src/modB/y.ts`_
### src/modB/y.ts
```
The header and Repository Map both say "module=modA" (correctly showing
only `src/modA/x.ts`), but the Target Files section — the part the model
actually reads as "the code to review" — is `src/modB/y.ts`, a file
outside the module entirely, with no warning that `--module` was ignored.

**Smallest fix:** in `select.ts`, when both `opts.diff` and `opts.module`
are set, intersect `diffSelection`'s seed/expansion files with
`moduleFiles(config, opts.module)` before returning. No test currently
exercises this combination (`test/core.test.mjs` and `test/diff.test.mjs`
only test each mode in isolation).

---

## 4. [Contract violation] `pack --diff`'s expansion ranking never demotes test files — the real caller can be crowded out entirely

**Where:** `src/select/diff.ts:76-89`. Every other ranking path in this
codebase (`core/repomap.ts`'s `rankFiles`, applied unconditionally at
lines 116-118) demotes test files by 0.2x specifically so they can't
outrank the production code an agent actually needs — a principle the
task brief and the repomap.ts comments call out explicitly as a
previously-fixed defect. `select/diff.ts`'s "who calls this changed
symbol" expansion scorer is a separate, standalone scan that sorts purely
by raw match count with **no** such demotion.

**Repro:** `src/discount.ts` exports `computeDiscount`, called once by a
real production file `src/checkout.ts`, and referenced (import + calls)
by 11 separate test files, each with more raw mentions of the name than
`checkout.ts` has:
```
ctxkit pack --diff HEAD --stdout | grep '^### '
```
```
### src/discount.ts
### tests/test_discount_1.spec.ts
### tests/test_discount_10.spec.ts
### tests/test_discount_11.spec.ts
### tests/test_discount_2.spec.ts
### tests/test_discount_3.spec.ts
### tests/test_discount_4.spec.ts
### tests/test_discount_5.spec.ts
### tests/test_discount_6.spec.ts
### tests/test_discount_7.spec.ts
### tests/test_discount_8.spec.ts
```
All 10 expansion slots (`MAX_EXPANSION`) fill with test files.
`src/checkout.ts` — the one real production caller of the changed
function, exactly what a reviewer needs to see — is completely absent
from the pack, with no indication it was ever considered.

**Smallest fix:** apply the same `TEST_PATH_RE` demotion (or exclude test
paths outright, as `health.ts`'s duplicate/orphan checks do) to
`select/diff.ts`'s expansion scoring loop before taking the top
`MAX_EXPANSION`.

---

## 5. [Contract drift / divergent duplicate logic] Generic-name filtering exists in one of three near-identical reference scanners, not the other two

- `src/core/repomap.ts:82` (`rankFiles`'s cross-reference scan) excludes
  generic names via `COMMON_NAMES` (`update`, `create`, `delete`, `write`,
  `data`, `value`, `type`, …) *and* caps matches per file at 20.
- `src/checks/health.ts:207-226` (`findReferencedFiles`, orphan detection)
  only filters `name.length < 4` — no `COMMON_NAMES` exclusion.
- `src/select/diff.ts:64-89` (the `--diff` expansion set) copied the
  `length >= 4` threshold (`MIN_SYMBOL_LEN`) from repomap.ts but **not**
  the `COMMON_NAMES` exclusion sitting right next to it in the same file.

`COMMON_NAMES` is a local, unexported `const` in `repomap.ts`, so the other
two files had no shared place to import it from even if they'd tried.

**Repro:** git fixture, changed file `src/modA/x.ts` defines
`export function update(): void { console.log("updated"); }`. Unrelated
file `src/modB/y.ts` merely contains the English word "update" in a log
string (`console.log("please update the record")`), no call to `modA`'s
`update()`.
```
ctxkit pack --diff HEAD --stdout
```
`src/modB/y.ts` is pulled into the Target Files section as an expansion
file purely because it contains the word "update" as English text. On a
real codebase, any changed function named something as common as
`create`/`update`/`delete`/`config`/`handler`/`value` will pollute every
`--diff` review pack with unrelated files.

The `health.ts` instance is lower-impact (it can only make orphan
detection *more conservative* — a false "referenced," never a false
"orphan," matching the plan's stated bias) but shares the same root cause.

**Smallest fix:** export `COMMON_NAMES` (or an `isGenericSymbolName`
helper) from `repomap.ts`/`core/text.ts` and use it in both
`select/diff.ts`'s expansion filter and `health.ts`'s reference scan.

---

## 6. [Performance / contract] `pack --about` exceeds the §6-B `<3s` budget at the plan's own reference scale

**Measured** (3 runs, twin repo, 308 source files):
```
time node dist/cli.js -C <twin> pack --about "risk score" --stdout >/dev/null
# 3.21s / 3.27s / 3.24s (real)
```
Budget per §6-B: `pack --about` at ~300 sources, `< 3초`. Consistently
misses it by ~7-10%.

**Root cause:** `rankFiles` (`repomap.ts:70-77`) reads every source file's
full contents into a local `contents` map to extract symbols and score
cross-references, then discards that map. The `Scorer` type
(`repomap.ts:50`) gives scorers only `RankedFile[]` (extracted `symbols[]`,
no body text) — so `scoreQuery`'s BM25 body field
(`scorers/query.ts:33-39`) has to `readText` **every file in the repo
again** and re-tokenize it from scratch, duplicating the full-corpus read
`rankFiles` just did.

**Smallest fix:** thread the `contents: Map<string,string>` `rankFiles`
already builds through to scorers (a third `Scorer` parameter, or body
text attached to `RankedFile`) so `--about` doesn't force a second
full-corpus read.

---

## 7. [Performance smell] `pack --about --explain` costs ~2.7x a plain pack because the pack is built twice

**Measured** (twin, same query): plain `--about` 3.24s vs. `--explain`
8.96s.

**Where:** `src/cli.ts:174-190` — when `--explain` is passed, the `pack`
action calls `explainPack(config, opts)` (two `rankFiles` passes plus an
internal `buildPack(config, opts)` call at `pack.ts:296`), then
**unconditionally** calls `buildPack(config, opts)` again for the actual
output. With `--explain`, the whole pack is assembled from scratch twice.

**Smallest fix:** have `explainPack` return the `PackResult` it already
built alongside the score rows, or have `cli.ts` reuse it, instead of
building it a second time. Low urgency — `--explain` is a manual
debugging flag, not on the pre-commit hot path — but 9s is rough for the
interactive tuning loop `--explain` exists for.

---

## 8. [Smell] ctx-kit's own `check` is not, and cannot currently be, fully green

```
! [rot-path] AGENTS.md:40 references "eval/twin-tasks.yaml", which does not exist
! [rot-path] AGENTS.md:41 references "eval/results-twin.md", which does not exist
```
Both paths are real, deliberately-gitignored files (`.gitignore` lines
6-7; `AGENTS.md`'s own "Private-repo evidence stays local" bullet
documents exactly this convention). `checks/rot.ts`'s path check has no
notion of "documented but intentionally absent" — any repo following the
same pattern gets a permanent, unfixable `rot-path` warn. This undercuts
§9's stated bar for promoting `rot-path` to `fail` ("실전 2곳 오탐 0") —
the reference repo itself already shows 2. Low severity only because it's
`warn`, not `fail`.

**Smallest fix:** exempt paths matching a `.gitignore` pattern from the
existence check, or add a `rot.ignore_paths` config list mirroring
`health.orphan_ignore`.

---

## 9. [Smell] `checks/health.ts` duplicates `escapeRegExp` on purpose, to dodge its own duplicate-symbol check

`src/checks/health.ts:40-45` reimplements `core/text.ts`'s exported
`escapeRegExp` verbatim, under the name `reEscape`, with a comment
explaining the rename exists specifically so this file doesn't trip its
own duplicate-symbol checker. The two functions are character-for-character
identical; `escapeRegExp` is already imported by `mcp.ts`, `repomap.ts`,
and `select/diff.ts`. Harmless functionally, but it's acknowledged
duplication kept alive specifically to stay invisible to the tool's own
lint — worth a second look at what the duplicate check actually catches
in the wild.

**Smallest fix:** `import { escapeRegExp } from "../core/text.js"`, delete
`reEscape`.

---

## 10. [Smell] Dead code and test-only exports

- `src/core/config.ts:128` `findConfig(startDir)` — walks parent
  directories looking for `context.config.yaml`. Never called from
  `cli.ts`, `mcp.ts`, any other `src/` file, or any test (`loadConfig`
  always does `join(root, CONFIG_FILE)` on whatever `-C`/`--dir` resolves
  to). Not currently causing wrong behavior (the README documents `-C` as
  always pointing at the repo root), but fully unreachable — the same
  shape as the tokenizer adapter before it was wired in.
- `src/adapters/tokenizer.ts:50,60` `exactTokenizerAvailable()` and
  `countTokens()` — exported, but only imported by `test/tokens.test.mjs`;
  product code (`cli.ts:350`, `mcp.ts:34`) only calls
  `installExactTokenizer()`. Only two-thirds of this adapter's public
  surface is actually wired in.
- `src/scorers/query.ts:25` `scoreQuery()` — exported but only called from
  `makeQueryScorer` in the same file.
- `src/checks/types.ts:41` `CheckOptions.noBaseline` — threaded into
  `runChecks`/`CheckContext.opts`, but no check ever reads it; the real
  `--no-baseline` behavior lives entirely in `cli.ts:236`, outside the
  check pipeline. Not a bug, just a vestigial field.

Everything else swept (`repomix.ts`, `imports.ts`, `symbols.ts`, `get.ts`,
`detect.ts`, `text.ts`, `select/diff.ts`, `eval.ts`, `scorers/cochange.ts`)
has a real product-code caller. `adapters/ruler.ts` (and, by the same
pattern, `serena.ts`) are intentional empty placeholder stubs
(`export {}`), documented as future extension points, not dead code.

---

## 11. [Smell] `gpt-tokenizer` is a `devDependency`, not an `optionalDependency` — comment/manifest mismatch, and no auto-install for consumers

`src/adapters/tokenizer.ts`'s file comment says: "never a hard dependency
— see optionalDependencies in package.json." `package.json` has no
`optionalDependencies` section; `gpt-tokenizer` is under `devDependencies`
(confirmed via `npm pack --dry-run` — the published tarball's manifest
carries it as a dev dependency). Practical effect: `devDependencies` are
never installed transitively, so `npm install @seanshin/ctx-kit` will
**not** pull in `gpt-tokenizer` for a consumer the way `optionalDependencies`
would. It's not fully unreachable — a user can still `npm install
gpt-tokenizer` in their own project and Node's directory-walking module
resolution will find it from ctx-kit's dynamic `import()` — but that's a
manual extra step the code's own comment implies shouldn't be necessary.
Functionally safe either way (the fallback path is tested and never
throws).

**Smallest fix:** either move `gpt-tokenizer` to `optionalDependencies` (to
match the comment and the "accelerator that installs itself" framing) or
correct the comment to describe the actual (manual, devDependency-only)
opt-in path.

---

## What I checked and found clean

- **Seeds never dropped under budget pressure** (`pack.ts:185-213`):
  confirmed by code, the existing "diff: seeds survive the budget" test,
  and a manual oversized-file run.
- **Map capped at budget/3**: `Math.min(Math.floor(budget / 3), 4000)` at
  `pack.ts:135`, exactly as specified.
- **Co-change never applied to the global/unscoped map**: `buildRepoMap`
  never receives `scorers`; `coChangeSeeds`/`makeCoChangeScorer` are only
  reachable from `pack.ts`'s target-files path and return `[]` when none
  of module/diff/about apply (`scorers/cochange.ts:184-197`).
- **`check` never fails on `info`**: verified by code (`cli.ts`'s
  fail-count filter counts only `level === "fail"`) and empirically (a
  coverage `info` violation alone still exits 0).
- **Orphan check abstains on zero-symbol files**: verified by code
  (`health.ts` `findOrphans`, `skippedNoSymbols`) and empirically against
  a synthetic repo, ctx-kit itself, and twin.
- **§10 security**: no user input reaches a shell anywhere except the two
  explicitly-gated, opt-in sites — `checks/rot.ts`'s `--run-commands`
  (never in `init --ci`/`init --hooks` templates; verified by reading
  both templates) and `eval.ts`'s model invocation (only runs after a
  call-count confirmation or explicit `--yes`). Every git call
  (`core/git.ts`, `scorers/cochange.ts`) uses `spawnSync` with an argument
  array, never `shell: true`, including for user-supplied `--diff` ranges.
- **§6-C degradation, tested empirically:**
  - Non-git directory: `pack --diff` gives a clear named error; `pack`,
    `pack --about`, `check`, `map` all work normally.
  - 1-commit git repo with `ranking.cochange: true`: no crash;
    co-change silently contributes nothing (`MIN_HISTORY_COMMITS` gate).
  - No `modules` defined: coverage check reports a clean `ok` "skipped"
    result; `pack --module <unknown>` errors clearly.
  - No `constraints` defined: constraint check reports a clean `ok`
    "skipped" result.
  - `--diff --staged` with nothing staged: a valid pack with an empty seed
    list, not an error.
- **Baseline ratchet full lifecycle**: injected violation → `check` fails
  → `--update-baseline` → `check` passes at `warn` with a ratchet note →
  `--no-baseline` re-fails. Exactly as specified.
- **MCP surface**: exactly 5 tools (`tools/list` test + manual read),
  health-check results are not exposed over MCP, `about`/`diff` params
  match the plan's table.
- **Performance, everything else measured:**
  - `ctxkit check` on ctx-kit itself (~45 sources): 0.31s.
  - `ctxkit check` on twin (308 sources): ~1.9s — under the `<2s` budget
    but with less margin than I'd like; ranking is correctly computed
    **once** and shared via `CheckContext.ranked()`'s memoization
    (`core/check.ts:19-23`) — no second `rankFiles` call inside `check`
    itself. The gap between `check`'s 1.9s and `map`'s solo 1.4s is
    `health.ts`'s separate `findReferencedFiles` scan, which its own
    comment already discloses as "expect roughly double the
    reference-scanning cost" — a deliberate, documented tradeoff rather
    than a hidden bug, though it does eat most of the budget's margin.
  - `ctxkit map` on twin: ~1.4s.
  - The §6-B "~5,000 sources → health checks only under `--full`" escape
    valve is not implemented (no `--full` flag anywhere). Not counted as
    a new finding — plan-v2 §11 already lists this as an open,
    unverified item.
- **Dead-code sweep**: `repomix.ts`, `imports.ts`, `symbols.ts`, `get.ts`,
  `detect.ts`, `text.ts`, `select/diff.ts`, `eval.ts`,
  `scorers/cochange.ts` all have real product-code callers.
