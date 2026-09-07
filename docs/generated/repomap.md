<!-- ctxkit:v1 repomap generated=2026-09-07T07:27:15.237Z budget=8000 -->
# Repository Map

Files: 19 source files scanned. Ranked by cross-file references.

## src/core/config.ts
- L5 const `CONFIG_FILE`
- L6 const `SCHEMA_VERSION`
- L7 const `GENERATED_DIR`
- L9 interface `ProfileConfig`
- L16 interface `CtxConfig`
- L28 const `DEFAULT_PROFILES`
- L34 const `BUILTIN_IGNORE_DIRS`
- L50 function `findConfig(startDir: string)`
- L61 function `loadConfig(rootDir: string)`

## src/core/fs.ts
- L6 interface `WalkOptions`
- L15 function `walkFiles(root: string, opts: WalkOptions = {})`
- L25 function `visit`
- L57 function `readText(root: string, rel: string)`

## src/adapters/symbols.ts
- L10 interface `CodeSymbol`
- L17 const `SOURCE_EXTENSIONS`
- L23 interface `Rule`
- L84 function `extractSymbols(relPath: string, content: string)`

## src/mcp.ts
- L20 function `text(s: string)`
- L24 function `escapeRegExp(s: string)`
- L28 function `sourceFiles(config: CtxConfig)`
- L34 function `startMcpServer(rootDir: string)`

## src/core/repomap.ts
- L15 interface `RepoMapOptions`
- L23 interface `RankedFile`
- L34 function `escapeRegExp(s: string)`
- L49 function `rankFiles(config: CtxConfig, relFiles?: string[])`
- L84 function `buildRepoMap(config: CtxConfig, opts: RepoMapOptions = {})`

## eval/run.mjs
- L33 function `argVal`
- L43 function `profiles`
- L44 function `models`
- L56 function `buildContext(profile)`
- L80 function `answer`

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

## src/core/pack.ts
- L16 interface `PackOptions`
- L21 interface `PackResult`
- L38 function `readAgents(config: CtxConfig)`
- L43 function `agentsSummary(agents: string, maxLines = 40)`
- L47 function `moduleFiles(config: CtxConfig, moduleName: string)`
- L56 function `targetFiles(config: CtxConfig, moduleName?: string)`
- L66 function `buildPack(config: CtxConfig, opts: PackOptions)`

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
- L15 interface `CheckResult`
- L21 interface `CheckOptions`
- L32 function `scanSecrets(config: CtxConfig)`
- L58 function `runChecks(config: CtxConfig, opts: CheckOptions = {})`

## src/adapters/repomix.ts
- L11 function `repomixAvailable()`
- L16 function `runRepomix(root: string, args: string[])`

## src/cli.ts
- L25 function `rootDir()`
- L29 function `writeOutput(root: string, relPath: string, content: string, stdout: boolean)`

## test/mcp.test.mjs
- L21 function `send(method, params)`
- L31 function `callTool(name, args = {})`

## test/core.test.mjs
- L18 function `makeRepo(files = {})`

## src/adapters/ruler.ts
- (no extractable symbols)

## src/adapters/serena.ts
- (no extractable symbols)

