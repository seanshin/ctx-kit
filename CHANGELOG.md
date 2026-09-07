# Changelog

## 0.3.0 — 2026-09-08

Context stops being one fixed shape per repository and starts being shaped by
the task, and the gate stops inspecting only the context artifacts and starts
inspecting the repository they describe. Planned in
[docs/plan-v2.md](docs/plan-v2.md), built by seven parallel work streams over
isolated worktrees, then reviewed adversarially
([docs/review-wave3.md](docs/review-wave3.md)).

### Added

- **`ctxkit eval`** — the measurement harness ships as a command. `--dry-run`
  reports two inclusion rates per profile without calling a model, so choosing
  a profile costs nothing: `outline_hit` (did the answering file reach the
  map — enough for "where is X?") and `content_hit` (did its source reach the
  pack — needed for "what is this value?"). Verified to agree with the model
  measurements cell by cell.
- **`pack --about "<task>"`** — ranks files by BM25 over three fields (path 3,
  symbols 2, body 1) composed onto the reference ranking. CJK is indexed as
  character bigrams so a Korean query survives particle changes; conservative
  English stemming folds plurals and `-ing`/`-ed`. Measured on ten queries
  against this repository: the expected file's mean rank went 4.3 → 1.5 with
  no query getting worse.
- **`pack --diff <range|--staged>`** — centers a pack on a change. Changed
  files are seeds and are never dropped for budget reasons; if seeds alone
  exceed the budget the section degrades to a seed path list plus the
  top-ranked seed's contents.
- **`pack --explain`** — the score breakdown (reference, scorers, demotion,
  final, included) for the top files, read from what the ranker recorded.
- **Repository health checks** — `constraint` (symbol location, forbidden
  imports, forbidden patterns), `duplicate`, `orphan`, `coverage`, and
  rule/config rot (`rot-path`, `rot-command`, `rot-module`). Adopt them on an
  existing codebase with `check --update-baseline`, which records today's
  violations so only new ones fail.
- **Co-change ranking** (`ranking.cochange`, off by default) — git history
  surfaces files that change together with a module but share no text with
  it. Adopted against a stated kill criterion after a 506-commit repository
  produced verified cases: a model class and the migration creating its table,
  and docs-to-implementation coupling at 1.8× the base rate.
- **Optional exact tokenizer** — `CTXKIT_EXACT_TOKENS=1` with `gpt-tokenizer`
  (MIT) installed. Opt-in rather than on-when-present, so counts stay
  identical everywhere by default and published measurements stay
  reproducible.

### Changed

- **Token counting is honest about CJK.** `chars/4` underestimated a
  Korean-commented file by 28%; CJK codepoints now count at a measured 0.95
  tokens/character, cutting the error to 9%. ASCII counts are unchanged. A
  `light` pack of one Korean module was overpacking by three files' worth.
- **Module packs get a module-scoped map** plus a paths-only index of the
  most-referenced files elsewhere, and of files that change together with the
  module. Measured trade-off: a module pack cannot say where an outside symbol
  is defined — send those to `search_symbol` or drop `--module`.
- **Tests are demoted across every ranking signal**, not just the reference
  score, so a query can no longer lift a test file above the implementation it
  tests.
- **Oversized files are skipped, not treated as a stop sign** — one large file
  in the middle of the ranking no longer forfeits the budget for the smaller
  files behind it.
- Internals: checks are one file each behind a registry, ranking composes
  `Scorer` functions, selection lives in `core/select.ts`, and the CLI/MCP
  surface is declared in one place. This is what let seven streams work in
  parallel without colliding.

### Fixed

- Typed `const` declarations (`export const fn: Handler = …`) were never
  extracted, so TypeScript files exporting them got no reference credit.
- `--about` and `--diff` were silent no-ops on profiles without a target-files
  section; they now say so.
- `pack --diff --module` showed out-of-module files under a module heading.
- The diff expansion never demoted tests and lacked the generic-name filter,
  so a widely-tested change could fill every expansion slot with its own tests
  and drop the production caller a reviewer needs.
- `--explain` recomputed the ranking instead of reading it, three times over.
  The ranker now records its own breakdown so the divergence cannot recur.
- `--run-commands` spawned documented `watch`/`dev` commands and burned the
  full timeout; they are skipped by design and named in the output.
- `check` gained an `info` level so coverage findings stop being reported as
  warnings, and the baseline keys on structured location rather than prose, so
  rewording a message no longer invalidates a recorded violation.
- `eval --tasks` with an absolute path could never resolve; `outline_hit`
  counted a bare path mention as an outline hit and overstated what a profile
  could answer.
- `pack --about` re-read every file inside the scorer and missed the
  performance budget: 3.2s → 1.5s on a 308-file repository.

### Measurements

`eval/findings.md` records six rounds. The load-bearing result is unchanged
and now reproducible for free: **what decides whether a task succeeds is the
context form, not the model grade** — an implementation-detail question failed
on every model tier without file contents and passed on every tier with them.

## 0.2.x — 2026-09-07

Initial public releases: rules sync, ranked repository maps, profile-aware
context packs, the MCP server, the check gate, and the first real-repository
onboarding. See [docs/ai-context-plan.md](docs/ai-context-plan.md) and
[docs/package-architecture.md](docs/package-architecture.md).
