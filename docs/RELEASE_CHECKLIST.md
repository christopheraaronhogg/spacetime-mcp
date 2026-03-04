# SpacetimeMCP Release Checklist

Use this checklist for every public release, with special attention before `1.0.0`.

## 1) Version and Metadata

- [ ] Bump versions consistently in `package.json`, `package-lock.json`, and `src/version.ts`.
- [ ] Confirm `README.md` current phase/version references are updated.
- [ ] Confirm package metadata (`name`, `license`, `engines`, `files`) is accurate.

## 2) Quality Gates

- [ ] `npm run check` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] CI workflow on `.github/workflows/ci.yml` passes on the release commit.

## 3) MCP Contract Stability

- [ ] Verify tool names and order are unchanged unless intentionally versioned.
- [ ] Verify required args and enum fields match expected tool contract.
- [ ] Verify unknown CLI usage returns stable error codes and usage exit code `2`.
- [ ] Verify runtime failures return exit code `1`.

## 4) Install/Update Compatibility Matrix

- [ ] Generic MCP (`.mcp.json`) merge behavior works with existing servers.
- [ ] OpenCode (`opencode.json`) merge behavior preserves unrelated keys.
- [ ] Codex (`.codex/config.toml`) section upsert is idempotent.
- [ ] Antigravity (`mcp_config.json`) merge behavior works with existing servers.
- [ ] `--target` and `--dry-run` produce expected output.
- [ ] `--json` output is machine-readable for success and error cases.

## 5) Packaging Smoke

- [ ] `npm run smoke:package` passes.
- [ ] Installed tarball can run `install` and `update` in a clean temp workspace.
- [ ] Produced resources include expected target config and managed metadata files.

## 6) Release Candidate Validation

- [ ] Validate docs-search behavior with and without `SPACETIME_MCP_DOCS_API_URL`.
- [ ] Validate skill and guidelines loading from `.ai/` and `.spacetime/` folders.
- [ ] Confirm no secrets or local-only files are included in the package.

## 7) Publish and Tag

- [ ] Create release notes summarizing user-facing changes and migration notes.
- [ ] Create git tag `vX.Y.Z` on the release commit.
- [ ] Publish package and verify install from npm in a fresh directory.

## 1.0.0 Sign-Off

- [ ] All checklist sections completed.
- [ ] No open high-severity bugs on install/update, tool contract, or docs search.
- [ ] Compatibility confirmed for OpenCode, Antigravity, and Codex.
