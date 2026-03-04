# SpacetimeMCP 1.0.0 RC Validation Report

Date: 2026-03-04

## Summary

- Status: PASS
- Scope: release-candidate validation for install/update compatibility, CLI contracts, MCP tool contract, and package behavior.

## Commands Executed

```bash
npm test
npm run check
npm run build
npm run smoke:package -- --skip-build
```

## Observed Results

- Full test suite passed.
- Type checking passed.
- Build passed.
- Package smoke passed against installed tarball.

## Compatibility Playbook Coverage

- Baseline install validated with `--json` output and all targets.
- Existing config merge safety validated for `.mcp.json`, `opencode.json`, `.codex/config.toml`, and `mcp_config.json`.
- Target scoping validated (`--target codex` path covered in integration tests).
- Dry-run behavior validated (`--dry-run` + no-write behavior covered in tests and smoke).
- Error contract validated (`ERR_INVALID_TARGET`, usage exit code `2`).

## Notes

- CI workflow includes check, test, build, and package smoke gates.
- Publish/tag tasks remain manual release steps.
