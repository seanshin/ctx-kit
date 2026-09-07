/**
 * Serena integration note.
 *
 * Tier 3 LSP-grade semantic search is NOT reimplemented here: Serena
 * (MIT) is itself an MCP server, so clients attach it alongside ctxkit
 * (e.g. `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`).
 * ctxkit's `search_symbol` tool is the dependency-free, outline-based
 * fallback and says so in its description, steering agents to Serena
 * when deeper analysis is needed.
 */
export {};
