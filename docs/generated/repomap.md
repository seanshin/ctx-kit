<!-- ctxkit:v1 repomap generated=2026-09-07T23:35:43.609Z budget=8000 -->
# Repository Map

Files: 44 source files scanned. Ranked by cross-file references.

## src/core/config.ts
- L5 const `CONFIG_FILE`
- L6 const `SCHEMA_VERSION`
- L7 const `GENERATED_DIR`
- L9 interface `ProfileConfig`
- L17 type `Level`
- L23 interface `Constraint`
- L37 interface `HealthConfig`
- L46 interface `RankingConfig`
- L56 interface `RotConfig`
- L69 interface `CtxConfig`
- L86 const `DEFAULT_HEALTH`
- L93 const `DEFAULT_RANKING`
- L99 const `DEFAULT_ROT`
- L104 const `BASELINE_FILE`
- L106 const `DEFAULT_PROFILES`
- L112 const `BUILTIN_IGNORE_DIRS`
- L128 function `findConfig(startDir: string)`
- L139 function `loadConfig(rootDir: string)`

## src/mcp.ts
- L22 function `text(s: string)`
- L27 function `sourceFiles(config: CtxConfig)`
- L33 function `startMcpServer(rootDir: string)`

## src/eval.ts
- L24 interface `EvalTask`
- L36 interface `ModelSpec`
- L42 const `DEFAULT_PROFILES`
- L43 const `DEFAULT_MODELS_SPEC`
- L44 const `DEFAULT_TASKS_RELATIVE`
- L45 const `DEFAULT_RESULTS_RELATIVE`
- L53 const `TASKS_TEMPLATE`
- L103 function `loadTasks(path: string)`
- L122 function `parseModelsArg(models: string | undefined, custom: string | undefined)`
- L123 function `list`
- L154 function `extractSection(content: string, heading: string)`
- L168 interface `DryRunCell`
- L177 interface `DryRunProfileRate`
- L186 interface `DryRunReport`
- L198 function `dryRunEval(`
- L251 function `pct(x: number)`
- L255 function `formatDryRunReport(report: DryRunReport)`
- L281 interface `ModelEvalResult`
- L291 function `plannedCallCount(profiles: string[], models: ModelSpec[], tasks: EvalTask[])`
- L300 function `defaultConfirm(message: string)`
- L313 interface `RunEvalOptions`
- L326 interface `RunEvalReport`
- L331 function `formatResultsMarkdown(`
- L359 function `runModelEval(`
- L397 function `answer`

## src/core/repomap.ts
- L16 interface `RepoMapOptions`
- L24 interface `RankedFile`
- L44 const `COMMON_NAMES`
- L55 const `TEST_PATH_RE`
- L58 const `TEST_DEMOTION`
- L67 type `Scorer`
- L74 interface `RankOptions`
- L85 function `rankFiles(config: CtxConfig, opts: RankOptions = {})`
- L164 function `buildRepoMap(config: CtxConfig, opts: RepoMapOptions = {})`

## src/checks/types.ts
- L9 interface `CheckResult`
- L36 interface `CheckOptions`
- L44 interface `CheckContext`
- L55 interface `Check`

## eval/run.mjs
- L40 function `argVal`
- L57 function `profiles`

## src/core/fs.ts
- L6 interface `WalkOptions`
- L15 function `walkFiles(root: string, opts: WalkOptions = {})`
- L25 function `visit`
- L57 function `readText(root: string, rel: string)`

## src/core/retrieve.ts
- L30 function `splitCompoundWord(word: string)`
- L75 function `undoubleFinal(s: string)`
- L94 function `foldStrippedSuffix(original: string, bare: string)`
- L115 function `stem(token: string)`
- L163 function `tokenize(text: string)`
- L182 interface `Bm25Doc`
- L187 interface `Bm25Options`
- L206 function `bm25(docs: Bm25Doc[], queryTerms: string[], opts: Bm25Options = {})`

## src/core/select.ts
- L17 interface `SelectOptions`
- L26 interface `Selection`
- L38 function `moduleFiles(config: CtxConfig, moduleName: string)`
- L47 function `allSourceFiles(config: CtxConfig)`
- L53 function `select(config: CtxConfig, opts: SelectOptions = {})`

## src/adapters/symbols.ts
- L10 interface `CodeSymbol`
- L24 const `SOURCE_EXTENSIONS`
- L30 interface `Rule`
- L91 function `extractSymbols(relPath: string, content: string)`

## src/core/pack.ts
- L18 interface `PackOptions`
- L27 interface `PackResult`
- L54 function `readAgents(config: CtxConfig)`
- L59 function `agentsSummary(agents: string, maxLines = 40)`
- L63 function `fileBlock(config: CtxConfig, rel: string)`
- L77 function `assembleScorers(`
- L91 function `targetFiles(config: CtxConfig, opts: PackOptions)`
- L109 function `buildPack(config: CtxConfig, opts: PackOptions)`
- L295 interface `ExplainRow`
- L326 function `explainPack(config: CtxConfig, opts: PackOptions)`

## src/core/tokens.ts
- L34 function `isCJK(codePoint: number)`
- L56 function `setTokenCounter(fn: (text: string)`
- L60 function `approxTokens(text: string)`
- L64 function `heuristicTokens(text: string)`

## src/scorers/cochange.ts
- L36 function `git(root: string, args: string[])`
- L41 function `headCommit(root: string)`
- L46 function `isShallow(root: string)`
- L50 function `historyDepth(root: string)`
- L61 function `coChangeAvailable(root: string)`
- L71 interface `CacheEntry`
- L80 function `cachePath(root: string)`
- L84 function `readDiskCache(root: string)`
- L97 function `writeDiskCache(root: string, entry: CacheEntry)`
- L112 function `filteredCommits(root: string, limit: number)`
- L137 function `seedColumnSums(seeds: string[], commits: string[][])`
- L161 function `makeCoChangeScorer(seeds: string[])`
- L188 function `isIgnoredPath(rel: string)`
- L207 function `coChangeOutsideModule(`
- L236 function `coChangeSeeds(`

## src/core/baseline.ts
- L32 const `BASELINE_SCHEMA_VERSION`
- L34 interface `BaselineEntry`
- L44 interface `BaselineFile`
- L49 function `baselinePath(root: string)`
- L61 function `readBaseline(root: string)`
- L72 function `writeBaseline(root: string, entries: BaselineEntry[])`
- L87 function `entryKey(e: { check: string; location?: { file: string; line?: number }; subject?: string; identifier?: string })`
- L94 function `resultKey(r: CheckResult)`
- L105 function `toBaselineEntries(results: CheckResult[])`
- L121 function `applyBaseline(results: CheckResult[], baseline: BaselineEntry[])`

## src/core/check.ts
- L16 function `runChecks(config: CtxConfig, opts: CheckOptions = {})`

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

## src/adapters/tokenizer.ts
- L25 type `Encoder`
- L30 function `loadEncoder()`
- L50 function `exactTokenizerAvailable()`
- L60 function `countTokens(text: string)`
- L76 function `installExactTokenizer()`

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

## src/core/git.ts
- L10 function `git(root: string, args: string[])`
- L15 function `isRepo(root: string)`
- L26 function `diffFiles(root: string, range: string)`
- L39 function `logCommits(root: string, limit = 500)`

## src/scorers/query.ts
- L25 function `scoreQuery(files: RankedFile[], config: CtxConfig, query: string, contents?: ReadonlyMap<string, string>)`
- L71 function `makeQueryScorer(query: string)`

## src/core/text.ts
- L2 function `escapeRegExp(s: string)`

## src/core/get.ts
- L16 interface `GetOptions`
- L21 interface `Section`
- L28 function `splitSections(source: string, text: string)`
- L40 function `countMatches(haystack: string, needle: string)`
- L52 function `getContext(config: CtxConfig, query: string, opts: GetOptions = {})`

## test/eval.test.mjs
- L17 function `makeRepo(files = {})`
- L33 function `writeTasks(root, yaml)`

## test/about.test.mjs
- L17 function `makeRepo(files = {})`

## src/checks/health.ts
- L26 function `isEntryPoint(rel: string)`
- L32 function `isDunder(name: string)`
- L36 function `normalizeSignature(sig: string)`
- L43 function `reEscape(s: string)`
- L51 function `checkConstraints(config: CtxConfig, entries: RankedFile[])`
- L143 interface `SymOcc`
- L155 function `findDuplicates(entries: RankedFile[])`
- L207 function `findReferencedFiles(entries: RankedFile[], contents: Map<string, string>)`
- L228 interface `OrphanResult`
- L233 function `findOrphans(config: CtxConfig, entries: RankedFile[], referenced: Set<string>)`
- L259 function `findUncovered(config: CtxConfig, entries: RankedFile[])`
- L268 const `healthCheck`

## src/checks/rot.ts
- L30 function `stripFences(content: string)`
- L46 function `commandSectionLines(lines: string[])`
- L60 interface `Backtick`
- L67 function `extractBackticks(lines: string[])`
- L77 function `isPathCandidate(text: string)`
- L85 function `isGlob(text: string)`
- L89 function `pathExists(root: string, allFiles: string[], candidate: string)`
- L97 function `isCommandCandidate(text: string)`
- L119 function `labelBefore(line: string, idx: number)`
- L129 function `nonTerminatingReason(text: string, label: string, skipCommands: string[])`
- L141 function `runnerOnPath(cache: Map<string, boolean>, runner: string)`
- L151 function `checkAgentsRot(ctx: CheckContext)`
- L264 function `checkModuleGlobRot(ctx: CheckContext)`
- L284 const `rotCheck`

## src/core/version.ts
- L4 function `VERSION`

## test/core.test.mjs
- L20 function `makeRepo(files = {})`

## test/gate.test.mjs
- L22 function `makeRepo(files = {})`
- L31 function `byName(results, name)`

## src/cli.ts
- L38 function `rootDir()`
- L46 function `printExplain(rows: ExplainRow[])`
- L47 function `col`
- L64 function `writeOutput(root: string, relPath: string, content: string, stdout: boolean)`

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

## test/cochange.test.mjs
- L24 function `git(cwd, args)`
- L37 function `makeGitRepo(count, commitFn)`
- L60 function `entriesFor(config, files)`

## test/mcp.test.mjs
- L21 function `send(method, params)`
- L31 function `callTool(name, args = {})`

## src/adapters/ruler.ts
- (no extractable symbols)

## src/adapters/serena.ts
- (no extractable symbols)

## test/tokens.test.mjs
- (no extractable symbols)

