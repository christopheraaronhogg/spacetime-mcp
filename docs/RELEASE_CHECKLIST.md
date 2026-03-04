# SpacetimeMCP Release Checklist

Use this checklist for every public release, with special attention before `1.0.0`.

## 1) Version and Metadata

- [x] Bump versions consistently in `package.json`, `package-lock.json`, and `src/version.ts`.
- [x] Confirm `README.md` current phase/version references are updated.
- [x] Confirm package metadata (`name`, `license`, `engines`, `files`) is accurate.

## 2) Quality Gates

- [x] `npm run check` passes.
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [ ] CI workflow on `.github/workflows/ci.yml` passes on the release commit.

## 3) MCP Contract Stability

- [x] Verify tool names and order are unchanged unless intentionally versioned.
- [x] Verify required args and enum fields match expected tool contract.
- [x] Verify unknown CLI usage returns stable error codes and usage exit code `2`.
- [x] Verify runtime failures return exit code `1`.

## 4) Install/Update Compatibility Matrix

- [x] Generic MCP (`.mcp.json`) merge behavior works with existing servers.
- [x] OpenCode (`opencode.json`) merge behavior preserves unrelated keys.
- [x] Codex (`.codex/config.toml`) section upsert is idempotent.
- [x] Antigravity (`mcp_config.json`) merge behavior works with existing servers.
- [x] `--target` and `--dry-run` produce expected output.
- [x] `--json` output is machine-readable for success and error cases.

## 5) Packaging Smoke

- [x] `npm run smoke:package` passes.
- [x] Installed tarball can run `install` and `update` in a clean temp workspace.
- [x] Produced resources include expected target config and managed metadata files.

## 6) Release Candidate Validation

- [x] Validate docs-search behavior with and without `SPACETIME_MCP_DOCS_API_URL`.
- [x] Validate skill and guidelines loading from `.ai/` and `.spacetime/` folders.
- [x] Confirm no secrets or local-only files are included in the package.
- [x] Execute `docs/COMPATIBILITY_PLAYBOOK.md` and record pass/fail notes.

## 7) Publish and Tag

- [x] Finalize `docs/RELEASE_NOTES_1.0.0.md` into release notes.
- [ ] Create git tag `vX.Y.Z` on the release commit.
- [ ] Publish package and verify install from npm in a fresh directory.

## 1.0.0 Sign-Off

- [ ] All checklist sections completed.
- [x] No open high-severity bugs on install/update, tool contract, or docs search.
- [x] Compatibility confirmed for OpenCode, Antigravity, and Codex.
