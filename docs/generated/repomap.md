<!-- ctxkit:v1 repomap generated=2026-09-07T08:06:13.948Z budget=8000 -->
# Repository Map

Files: 39 source files scanned. Ranked by cross-file references.

## src/core/config.ts
- L5 const `CONFIG_FILE`
- L6 const `SCHEMA_VERSION`
- L7 const `GENERATED_DIR`
- L9 interface `ProfileConfig`
- L17 type `Level`
- L23 interface `Constraint`
- L37 interface `HealthConfig`
- L46 interface `RankingConfig`
- L55 interface `CtxConfig`
- L71 const `DEFAULT_HEALTH`
- L78 const `DEFAULT_RANKING`
- L85 const `BASELINE_FILE`
- L87 const `DEFAULT_PROFILES`
- L93 const `BUILTIN_IGNORE_DIRS`
- L109 function `findConfig(startDir: string)`
- L120 function `loadConfig(rootDir: string)`

## src/eval.ts
- L23 interface `EvalTask`
- L35 interface `ModelSpec`
- L41 const `DEFAULT_PROFILES`
- L42 const `DEFAULT_MODELS_SPEC`
- L43 const `DEFAULT_TASKS_RELATIVE`
- L44 const `DEFAULT_RESULTS_RELATIVE`
- L52 const `TASKS_TEMPLATE`
- L102 function `loadTasks(path: string)`
- L121 function `parseModelsArg(models: string | undefined, custom: string | undefined)`
- L122 function `list`
- L153 function `extractSection(content: string, heading: string)`
- L167 interface `DryRunCell`
- L176 interface `DryRunProfileRate`
- L185 interface `DryRunReport`
- L197 function `dryRunEval(`
- L242 function `pct(x: number)`
- L246 function `formatDryRunReport(report: DryRunReport)`
- L272 interface `ModelEvalResult`
- L282 function `plannedCallCount(profiles: string[], models: ModelSpec[], tasks: EvalTask[])`
- L291 function `defaultConfirm(message: string)`
- L304 interface `RunEvalOptions`
- L317 interface `RunEvalReport`
- L322 function `formatResultsMarkdown(`
- L350 function `runModelEval(`
- L388 function `answer`

## src/mcp.ts
- L21 function `text(s: string)`
- L26 function `sourceFiles(config: CtxConfig)`
- L32 function `startMcpServer(rootDir: string)`

## src/checks/types.ts
- L9 interface `CheckResult`
- L15 interface `CheckOptions`
- L23 interface `CheckContext`
- L34 interface `Check`

## src/core/repomap.ts
- L16 interface `RepoMapOptions`
- L24 interface `RankedFile`
- L50 type `Scorer`
- L52 interface `RankOptions`
- L63 function `rankFiles(config: CtxConfig, opts: RankOptions = {})`
- L124 function `buildRepoMap(config: CtxConfig, opts: RepoMapOptions = {})`

## eval/run.mjs
- L40 function `argVal`
- L57 function `profiles`

## src/core/fs.ts
- L6 interface `WalkOptions`
- L15 function `walkFiles(root: string, opts: WalkOptions = {})`
- L25 function `visit`
- L57 function `readText(root: string, rel: string)`

## src/adapters/symbols.ts
- L10 interface `CodeSymbol`
- L24 const `SOURCE_EXTENSIONS`
- L30 interface `Rule`
- L91 function `extractSymbols(relPath: string, content: string)`

## src/core/pack.ts
- L17 interface `PackOptions`
- L26 interface `PackResult`
- L43 function `readAgents(config: CtxConfig)`
- L48 function `agentsSummary(agents: string, maxLines = 40)`
- L52 function `fileBlock(config: CtxConfig, rel: string)`
- L60 function `targetFiles(config: CtxConfig, opts: PackOptions)`
- L78 function `buildPack(config: CtxConfig, opts: PackOptions)`
- L226 interface `ExplainRow`
- L251 function `explainPack(config: CtxConfig, opts: PackOptions)`
- L263 function `shownRef`

## src/core/select.ts
- L17 interface `SelectOptions`
- L26 interface `Selection`
- L38 function `moduleFiles(config: CtxConfig, moduleName: string)`
- L47 function `allSourceFiles(config: CtxConfig)`
- L53 function `select(config: CtxConfig, opts: SelectOptions = {})`

## src/core/check.ts
- L14 function `runChecks(config: CtxConfig, opts: CheckOptions = {})`

## src/core/retrieve.ts
- L30 function `splitCompoundWord(word: string)`
- L54 function `tokenize(text: string)`
- L73 interface `Bm25Doc`
- L78 interface `Bm25Options`
- L97 function `bm25(docs: Bm25Doc[], queryTerms: string[], opts: Bm25Options = {})`

## src/core/sync.ts
- L20 const `SYNC_TARGETS`
- L32 function `expectedContent(agents: string)`
- L36 interface `SyncAction`
- L42 interface `SyncOptions`
- L47 function `resolveTargets(config: CtxConfig)`
- L62 function `isLinkToAgents(destPath: string, agentsPath: string)`
- L70 function `syncRules(config: CtxConfig, opts: SyncOptions = {})`
- L113 interface `SyncStatus`
- L119 function `checkSync(config: CtxConfig)`

## src/core/tokens.ts
- L7 function `approxTokens(text: string)`

## src/adapters/imports.ts
- L17 interface `ImportRef`
- L30 function `toPosix(p: string)`
- L34 function `existingFile(root: string, rel: string)`
- L48 function `resolveRelative(root: string, fromFile: string, specifier: string)`
- L64 function `resolvePythonRelative(root: string, fromFile: string, specifier: string)`
- L81 function `lineOffsets(content: string)`
- L87 function `lineAt(offsets: number[], index: number)`
- L91 function `mid`
- L107 function `extractJs(root: string, relPath: string, content: string)`
- L125 function `extractPy(root: string, relPath: string, content: string)`
- L148 function `extractGo(relPath: string, content: string)`
- L173 function `extractRs(relPath: string, content: string)`
- L190 function `extractImports(root: string, relPath: string, content: string)`

## src/core/detect.ts
- L13 interface `Detected`
- L22 function `detectCommandsIn(root: string, dir: string)`
- L25 function `at`
- L59 function `capitalize(s: string)`
- L65 function `detectProject(config: CtxConfig)`
- L104 function `renderConfig(detected: Detected)`
- L129 function `renderAgents(detected: Detected)`

## src/scorers/query.ts
- L25 function `scoreQuery(files: RankedFile[], config: CtxConfig, query: string)`
- L66 function `makeQueryScorer(query: string)`

## src/core/get.ts
- L16 interface `GetOptions`
- L21 interface `Section`
- L28 function `splitSections(source: string, text: string)`
- L40 function `countMatches(haystack: string, needle: string)`
- L52 function `getContext(config: CtxConfig, query: string, opts: GetOptions = {})`

## test/about.test.mjs
- L17 function `makeRepo(files = {})`

## test/eval.test.mjs
- L17 function `makeRepo(files = {})`
- L33 function `writeTasks(root, yaml)`

## src/core/text.ts
- L2 function `escapeRegExp(s: string)`

## src/checks/health.ts
- L22 function `resultLevel(configured: Level)`
- L36 function `isEntryPoint(rel: string)`
- L42 function `isDunder(name: string)`
- L46 function `normalizeSignature(sig: string)`
- L53 function `reEscape(s: string)`
- L61 function `checkConstraints(config: CtxConfig, entries: RankedFile[])`
- L146 interface `SymOcc`
- L158 function `findDuplicates(entries: RankedFile[])`
- L210 function `findReferencedFiles(entries: RankedFile[], contents: Map<string, string>)`
- L231 interface `OrphanResult`
- L236 function `findOrphans(config: CtxConfig, entries: RankedFile[], referenced: Set<string>)`
- L262 function `findUncovered(config: CtxConfig, entries: RankedFile[])`
- L271 const `healthCheck`

## src/checks/rot.ts
- L30 function `stripFences(content: string)`
- L46 function `commandSectionLines(lines: string[])`
- L60 interface `Backtick`
- L65 function `extractBackticks(lines: string[])`
- L75 function `isPathCandidate(text: string)`
- L83 function `isGlob(text: string)`
- L87 function `pathExists(root: string, allFiles: string[], candidate: string)`
- L95 function `isCommandCandidate(text: string)`
- L100 function `runnerOnPath(cache: Map<string, boolean>, runner: string)`
- L110 function `checkAgentsRot(ctx: CheckContext)`
- L177 function `checkModuleGlobRot(ctx: CheckContext)`
- L195 const `rotCheck`

## src/core/git.ts
- L10 function `git(root: string, args: string[])`
- L15 function `isRepo(root: string)`
- L26 function `diffFiles(root: string, range: string)`
- L39 function `logCommits(root: string, limit = 500)`

## src/core/version.ts
- L4 function `VERSION`

## test/gate.test.mjs
- L17 function `makeRepo(files = {})`
- L26 function `byName(results, name)`

## test/core.test.mjs
- L20 function `makeRepo(files = {})`

## src/cli.ts
- L37 function `rootDir()`
- L45 function `printExplain(rows: ExplainRow[])`
- L46 function `col`
- L61 function `writeOutput(root: string, relPath: string, content: string, stdout: boolean)`

## src/adapters/repomix.ts
- L11 function `repomixAvailable()`
- L16 function `runRepomix(root: string, args: string[])`

## src/checks/index.ts
- L15 const `CHECKS`

## src/checks/repomap.ts
- L12 const `repomapCheck`

## src/checks/rules.ts
- L6 const `rulesCheck`

## src/checks/secrets.ts
- L22 const `secretsCheck`

## src/checks/sync.ts
- L5 const `syncCheck`

## src/select/diff.ts
- L34 function `diffSelection(config: CtxConfig, range: string)`

## test/diff.test.mjs
- L12 function `git(cwd, args)`
- L25 function `makeGitRepo(commits)`

## test/mcp.test.mjs
- L21 function `send(method, params)`
- L31 function `callTool(name, args = {})`

## src/adapters/ruler.ts
- (no extractable symbols)

## src/adapters/serena.ts
- (no extractable symbols)

