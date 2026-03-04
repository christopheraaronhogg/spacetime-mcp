# SpacetimeMCP Compatibility Playbook

This playbook is used to validate end-to-end compatibility for the target MCP clients before `1.0.0`.

## Scope

- OpenCode (`opencode.json`)
- Codex (`.codex/config.toml`)
- Antigravity (`mcp_config.json`)
- Generic MCP (`.mcp.json`)

## Preconditions

1. Build artifacts are fresh:
   - `npm run build`
2. Quality checks pass:
   - `npm run check`
   - `npm test`
3. Package smoke passes:
   - `npm run smoke:package`

## Validation Steps

### 1) Baseline install

Run in a clean temp workspace:

```bash
npx spacetime-mcp install --json
```

Expected:

- JSON payload contains `ok: true` and `command: "install"`.
- `targets` includes `mcp`, `opencode`, `codex`, `antigravity`.
- Files exist:
  - `.mcp.json`
  - `opencode.json`
  - `.codex/config.toml`
  - `mcp_config.json`
  - `spacetime-mcp.json`
  - `.ai/guidelines/spacetimedb/core.md`
  - `.ai/skills/spacetimedb-development/SKILL.md`

### 2) Existing config merge safety

Prepare each client config with unrelated custom entries, then run:

```bash
npx spacetime-mcp update --json
```

Expected:

- Existing non-spacetime entries remain unchanged.
- `spacetime-mcp` entry is created or updated in each client config.
- No duplicate `mcp_servers.spacetime-mcp` sections in `.codex/config.toml`.

### 3) Target scoping

Run:

```bash
npx spacetime-mcp install --target codex --json
```

Expected:

- Output `targets` is exactly `["codex"]`.
- `.codex/config.toml` exists.
- Other target files are not created (`.mcp.json`, `opencode.json`, `mcp_config.json`).

### 4) Dry-run behavior

Run:

```bash
npx spacetime-mcp update --dry-run --json
```

Expected:

- Payload includes `dryRun: true`.
- No files are changed on disk.
- Created/updated/unchanged/skipped reporting is present.

### 5) Error contract

Run an invalid command:

```bash
npx spacetime-mcp install --target invalid --json
```

Expected:

- Process exits with code `2`.
- JSON error payload includes:
  - `ok: false`
  - `error.code: "ERR_INVALID_TARGET"`

## Exit Criteria

Compatibility is considered signed off when:

- Automated tests and package smoke pass in CI.
- Manual checks above pass once on a clean workspace for each release candidate.
