# SpacetimeMCP

SpacetimeMCP is an open-source Model Context Protocol (MCP) server that gives AI coding assistants high-signal context from a local SpacetimeDB workspace.

It is designed to stop common hallucinations (REST endpoints, SQL migrations, ORMs) and keep generated code aligned with SpacetimeDB tables, reducers, and client SDK usage patterns.

## Current Status

- Phase: `v0.1.0` bootstrap
- Language target for parsing: Rust-first MVP
- Full product vision and scope live in `docs/PRD.md`

## MVP Scope

- Parse Rust modules for `#[spacetimedb(table)]` structs
- Parse Rust reducers for `#[spacetimedb(reducer)]` functions
- Expose MCP tools:
  - `get_spacetime_schema`
  - `get_spacetime_reducers`
  - `get_spacetime_docs`

## Local Development

```bash
npm install
npm run dev
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

- `get_spacetime_schema`
  - Optional argument: `tableName`
  - Returns parsed tables, columns, and constraints
- `get_spacetime_reducers`
  - Optional argument: `reducerName`
  - Returns parsed reducers and argument signatures
- `get_spacetime_docs`
  - Returns grounding rules for SpacetimeDB-first patterns

## Project Layout

- `src/index.ts` - MCP stdio entrypoint
- `src/mcpServer.ts` - MCP tool registration and handlers
- `src/introspection/rustParser.ts` - Rust syntax extraction helpers
- `src/introspection/workspaceScanner.ts` - Workspace file discovery and aggregation
- `src/context/spacetimeDocs.ts` - Grounding guidance injected to LLMs
- `docs/PRD.md` - Product requirements document

## License

MIT
