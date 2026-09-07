<!-- ctxkit:v1 repomap generated=2026-09-07T07:52:24.788Z budget=8000 -->
# Repository Map

Files: 29 source files scanned. Ranked by cross-file references.

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

## eval/run.mjs
- L40 function `argVal`
- L57 function `profiles`

## src/checks/types.ts
- L9 interface `CheckResult`
- L15 interface `CheckOptions`
- L23 interface `CheckContext`
- L34 interface `Check`

## src/core/repomap.ts
- L15 interface `RepoMapOptions`
- L23 interface `RankedFile`
- L34 function `escapeRegExp(s: string)`
- L52 type `Scorer`
- L54 interface `RankOptions`
- L65 function `rankFiles(config: CtxConfig, opts: RankOptions = {})`
- L105 function `buildRepoMap(config: CtxConfig, opts: RepoMapOptions = {})`

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

## src/mcp.ts
- L20 function `text(s: string)`
- L24 function `escapeRegExp(s: string)`
- L28 function `sourceFiles(config: CtxConfig)`
- L34 function `startMcpServer(rootDir: string)`

## src/core/pack.ts
- L16 interface `PackOptions`
- L25 interface `PackResult`
- L42 function `readAgents(config: CtxConfig)`
- L47 function `agentsSummary(agents: string, maxLines = 40)`
- L51 function `targetFiles(config: CtxConfig, opts: PackOptions)`
- L63 function `buildPack(config: CtxConfig, opts: PackOptions)`

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

## src/core/select.ts
- L16 interface `SelectOptions`
- L25 interface `Selection`
- L37 function `moduleFiles(config: CtxConfig, moduleName: string)`
- L46 function `allSourceFiles(config: CtxConfig)`
- L52 function `select(config: CtxConfig, opts: SelectOptions = {})`

## src/core/detect.ts
- L13 interface `Detected`
- L22 function `detectCommandsIn(root: string, dir: string)`
- L25 function `at`
- L59 function `capitalize(s: string)`
- L65 function `detectProject(config: CtxConfig)`
- L104 function `renderConfig(detected: Detected)`
- L129 function `renderAgents(detected: Detected)`

## src/core/tokens.ts
- L7 function `approxTokens(text: string)`

## src/core/get.ts
- L16 interface `GetOptions`
- L21 interface `Section`
- L28 function `splitSections(source: string, text: string)`
- L40 function `countMatches(haystack: string, needle: string)`
- L52 function `getContext(config: CtxConfig, query: string, opts: GetOptions = {})`

## src/core/version.ts
- L4 function `VERSION`

## src/core/check.ts
- L14 function `runChecks(config: CtxConfig, opts: CheckOptions = {})`

## src/adapters/repomix.ts
- L11 function `repomixAvailable()`
- L16 function `runRepomix(root: string, args: string[])`

## src/cli.ts
- L36 function `rootDir()`
- L40 function `writeOutput(root: string, relPath: string, content: string, stdout: boolean)`

## src/checks/index.ts
- L13 const `CHECKS`

## test/eval.test.mjs
- L17 function `makeRepo(files = {})`
- L33 function `writeTasks(root, yaml)`

## src/checks/repomap.ts
- L12 const `repomapCheck`

## src/checks/rules.ts
- L6 const `rulesCheck`

## src/checks/secrets.ts
- L22 const `secretsCheck`

## src/checks/sync.ts
- L5 const `syncCheck`

## src/core/git.ts
- L10 function `git(root: string, args: string[])`
- L15 function `isRepo(root: string)`
- L26 function `diffFiles(root: string, range: string)`
- L39 function `logCommits(root: string, limit = 500)`

## test/core.test.mjs
- L20 function `makeRepo(files = {})`

## test/mcp.test.mjs
- L21 function `send(method, params)`
- L31 function `callTool(name, args = {})`

## src/adapters/ruler.ts
- (no extractable symbols)

## src/adapters/serena.ts
- (no extractable symbols)

