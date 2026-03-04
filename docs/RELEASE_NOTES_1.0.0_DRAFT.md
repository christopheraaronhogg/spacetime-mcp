# SpacetimeMCP v1.0.0 (Draft)

## Highlights

- Boost-style install/update workflow with non-destructive config merging.
- First-class compatibility targets for:
  - Generic MCP (`.mcp.json`)
  - OpenCode (`opencode.json`)
  - Codex (`.codex/config.toml`)
  - Antigravity (`mcp_config.json`)
- Expanded MCP tooling for SpacetimeDB schema, reducers, symbol search, docs search, and client call guidance.
- Structured CLI output with `--json` and stable usage/runtime error codes.
- Release quality gates with automated CI, package smoke checks, and tool contract regression tests.

## Notable Changes Since Early Milestones

- Added target-aware installer flags:
  - `--target all|mcp|opencode|codex|antigravity`
  - `--dry-run`
- Added merge-safe JSON and TOML upsert behavior for client config files.
- Added fixture-based regression tests for complex existing OpenCode and Codex configs.
- Added package-level smoke testing to validate real installed tarball behavior.

## CLI Contract

- Success exit code: `0`
- Runtime failure exit code: `1`
- Usage failure exit code: `2`
- `--json` response payloads:
  - Success: `{ ok: true, command, result }`
  - Error: `{ ok: false, error: { code, message } }`

## Installation

```bash
npm install -g spacetime-mcp
```

or run directly:

```bash
npx spacetime-mcp install
```

## Upgrade Notes

- If you already maintain client MCP configs, `spacetime-mcp` now merges rather than overwrites known config sections.
- If automation depends on CLI stderr text, prefer `--json` output for stable machine parsing.

## Verification Checklist

Before finalizing this release:

- Run `npm run check`
- Run `npm test`
- Run `npm run build`
- Run `npm run smoke:package`
- Complete `docs/RELEASE_CHECKLIST.md`
- Complete `docs/COMPATIBILITY_PLAYBOOK.md`

## Acknowledgements

- Design inspiration from Laravel Boost's install/update and compatibility ergonomics.
