# SpacetimeMCP

SpacetimeMCP is an open-source Model Context Protocol (MCP) server that gives AI coding assistants high-signal context from a local SpacetimeDB workspace.

It is designed to stop common hallucinations (REST endpoints, SQL migrations, ORMs) and keep generated code aligned with SpacetimeDB tables, reducers, and client SDK usage patterns.

## Current Status

- Phase: `v0.6.0` cross-client MCP install/update compatibility
- Language target for parsing: Rust-first MVP
- Full product vision and scope live in `docs/PRD.md`

## MVP Scope

- Parse Rust modules for `#[spacetimedb(table)]` structs
- Parse Rust reducers for `#[spacetimedb(reducer)]` functions
- Expose Boost-inspired MCP tools with focused context retrieval
- Support workspace-level AI guidelines and on-demand skills from `.ai/`
- Cache workspace context and invalidate cache when Rust files change

## Local Development

```bash
npm install
npm run dev
```

Install MCP resources into a workspace:

```bash
npx spacetime-mcp install
```

Install resources for selected clients only:

```bash
npx spacetime-mcp install --target codex
npx spacetime-mcp install --target mcp,opencode
```

Update managed MCP resources:

```bash
npx spacetime-mcp update
```

Preview changes without writing files:

```bash
npx spacetime-mcp update --dry-run
```

Run against another workspace root:

```bash
npm run dev -- /absolute/path/to/spacetimedb/project
```

Build and run:

```bash
npm run build
npm start
```

Run tests:

```bash
npm test
```

## MCP Tool Contract (MVP)

- `get_spacetime_app_info`
  - Returns language detection, workspace summary, scan metadata, and cache state
- `get_spacetime_schema`
  - Optional arguments: `tableName`, `contains`, `limit`, `refresh`
  - Returns parsed tables, columns, and constraints
- `get_spacetime_reducers`
  - Optional arguments: `reducerName`, `contains`, `limit`, `refresh`
  - Returns parsed reducers and argument signatures
- `search_spacetime_symbols`
  - Arguments: `query`, optional `kind`, `limit`, `refresh`
  - Returns ranked table and reducer matches by name/module
- `get_spacetime_client_call`
  - Arguments: `reducerName`, optional `client`, `refresh`
  - Returns TypeScript or Unity/C# reducer invocation guidance
- `get_spacetime_docs`
  - Optional arguments: `includeWorkspaceGuidelines`, `includeSkills`
  - Returns built-in grounding rules plus workspace guidelines and skill index
- `search_spacetime_docs`
  - Arguments: `query`, optional `source`, `limit`, `includeWorkspaceDocs`, `includeRemoteDocs`, `remoteEndpoint`, `remoteTimeoutMs`
  - Returns ranked documentation hits from built-in docs, local markdown resources, and optional remote docs APIs
- `list_spacetime_skills`
  - Lists skills from `.ai/skills/*/SKILL.md`
- `get_spacetime_skill`
  - Argument: `skillName`
  - Returns the markdown body for a specific skill

Remote docs API can be configured globally via `SPACETIME_MCP_DOCS_API_URL`.

## Generated Resources

Running `spacetime-mcp install` or `spacetime-mcp update` manages these workspace files:

- `.mcp.json` - generic MCP registration under `mcpServers`
- `opencode.json` - OpenCode MCP registration under `mcp`
- `.codex/config.toml` - Codex MCP registration under `mcp_servers`
- `mcp_config.json` - Antigravity MCP registration under `mcpServers`
- `spacetime-mcp.json` - package-level managed config metadata
- `.ai/guidelines/spacetimedb/core.md` - built-in SpacetimeDB grounding guidelines
- `.ai/skills/spacetimedb-development/SKILL.md` - on-demand skill for feature work

Managed files include a marker and are safe to refresh with `spacetime-mcp update`.
JSON and TOML config files are merged non-destructively so existing servers are preserved.

## Project Layout

- `src/index.ts` - MCP stdio entrypoint
- `src/cli/resourceInstaller.ts` - install/update generation for MCP resources
- `src/mcpServer.ts` - MCP tool registration and handlers
- `src/introspection/rustParser.ts` - Rust syntax extraction helpers
- `src/introspection/workspaceScanner.ts` - Workspace file discovery and aggregation
- `src/introspection/workspaceContextStore.ts` - Cached context invalidation by workspace fingerprint
- `src/context/spacetimeDocs.ts` - Grounding guidance injected to LLMs
- `src/context/workspaceKnowledge.ts` - Workspace guidelines and skills loader
- `src/context/clientInvocation.ts` - Reducer invocation mapping for TS/C# clients
- `src/context/contextQuery.ts` - Symbol search and lookup helpers
- `src/context/docsSearch.ts` - Built-in and workspace documentation search index
- `src/version.ts` - shared package and MCP server version constant
- `docs/PRD.md` - Product requirements document

## License

MIT
