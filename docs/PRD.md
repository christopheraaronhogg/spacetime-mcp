# Product Requirements Document: SpacetimeMCP

- Author: [Your Name]
- Date: March 2026
- Status: Draft / Ideation
- Target Release: `v1.0.0` (Open Source)

## 1. Executive Summary

SpacetimeMCP is an open-source Model Context Protocol (MCP) server designed specifically for SpacetimeDB projects. Inspired by Laravel Boost, it dynamically parses a local SpacetimeDB workspace and feeds structural context such as table schemas, reducers, and client SDK bindings directly to AI coding assistants (Cursor, Claude for Desktop, GitHub Copilot).

This allows AI agents to write idiomatic, highly accurate SpacetimeDB code without hallucinating traditional client-server REST patterns.

## 2. Problem Statement

Standard Large Language Models (LLMs) are trained heavily on traditional web frameworks (React + Node + Postgres). SpacetimeDB introduces a different paradigm: the database is the backend server, utilizing WebAssembly modules and reducers instead of HTTP endpoints and ORMs.

When developers ask an AI to "add a user inventory system to my SpacetimeDB game," the AI often:

- Hallucinates traditional SQL or REST API endpoints.
- Forgets or misapplies SpacetimeDB-specific macros/decorators (for example, `#[spacetimedb(table)]` in Rust).
- Loses track of existing reducers and table schemas, leading to broken client-side SDK calls.
- Requires the developer to repeatedly paste schemas and docs into chat.

## 3. Target Audience

- Game developers and multiplayer app creators building real-time backends with SpacetimeDB.
- AI-assisted programmers using Cursor, Windsurf, or Claude Desktop who want AI to understand their local SpacetimeDB workspace instantly.

## 4. Product Vision and Goals

Vision: Make building with SpacetimeDB and AI seamless, turning the assistant into a senior SpacetimeDB engineer that understands current local project state.

Core goals:

- Zero-config context: automatically detect module language (Rust, C#, TypeScript, Python) and parse without complex setup.
- Context optimization: deliver high-signal, low-noise context to preserve tokens and improve output quality.
- Modular skills architecture: expose targeted MCP tools (for example, `read_schema`, `read_reducers`, `get_client_bindings`) so the AI requests only what it needs.

## 5. Core Features (Phase 1 / MVP)

### Feature 1: The Introspection Engine (Parser)

Description: Scan the `server/` or `module/` directory to identify SpacetimeDB tables and reducers via language-specific syntax.

MVP scope: Rust SpacetimeDB SDK support first (highest adoption).

Requirements:

- Identify structs marked with `#[spacetimedb(table)]`.
- Identify functions marked with `#[spacetimedb(reducer)]`.
- Extract column names, data types, and constraints (for example, `#[unique]`).

### Feature 2: MCP Server Implementation

Description: A standard MCP server that AI assistants can connect to.

Requirements:

- Implement MCP resources and tools endpoints.
- Tool 1: `get_spacetime_schema` - return a consolidated JSON or Markdown representation of all database tables.
- Tool 2: `get_spacetime_reducers` - return all reducers, required arguments, and associated module.
- Tool 3: `get_spacetime_docs` - inject fundamental SpacetimeDB paradigm rules (for example, "Do not use HTTP, use reducers") to ground the LLM.

### Feature 3: Client SDK Context Mapping

Description: Connect backend schema to client code (Unity, TypeScript, and others).

Requirements:

- Let AI query how a specific reducer on the server should be invoked on the client side, based on generated SpacetimeDB SDK patterns.

## 6. Technical Architecture

- Language/Stack: Node.js/TypeScript or Rust.
- Recommendation: Rust is preferred to parse Rust sources via `syn`, or TypeScript if prioritizing regex/AST parsing across multiple languages.
- Distribution:
  - Published as an npm package (`npx @[username]/spacetime-mcp`) or compiled binary (Homebrew/Cargo).
  - Usable in `cursor.json` or `claude_desktop_config.json`.

## 7. User Flow

1. Developer installs the tool (`npm install -g spacetime-mcp`).
2. Developer adds MCP server to AI editor config (for example, Cursor settings).
3. Developer opens their SpacetimeDB project in Cursor.
4. Developer asks: "Create a new reducer that allows a player to trade an item with another player."
5. AI triggers `get_spacetime_schema` and `get_spacetime_reducers` via MCP.
6. AI reads existing Player and Item tables, then writes exact compiling Rust/C# code for a new reducer matching project schema.

## 8. Success Metrics (Post-Launch)

- GitHub stars and forks (community interest).
- npm or Cargo downloads over time.
- Community contributions (PRs for C#, Python, and TypeScript support).
- Latency target: MCP server returns context in under 500 ms.

## 9. Future Roadmap (Phase 2 and Beyond)

- Multi-language support: full parser support for C#, Python, and TypeScript modules.
- Spacetime CLI integration: hook into `spacetime generate` for exact generated client bindings.
- SpacetimeDB Cloud context: optional read-only live database state so AI can help write migration plans using production-aware context.
