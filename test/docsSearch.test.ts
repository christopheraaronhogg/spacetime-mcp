import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getBuiltinSpacetimeDocs,
  loadWorkspaceDocs,
  searchDocsIndex,
  searchSpacetimeDocs
} from "../src/context/docsSearch.js";

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-docs-test-"));

  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  source: string
): Promise<void> {
  const fullPath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, source, "utf8");
}

test("searchDocsIndex ranks reducer guidance from built-in docs", () => {
  const hits = searchDocsIndex(getBuiltinSpacetimeDocs(), "ReducerContext reducer", {
    source: "builtin",
    limit: 5
  });

  assert.equal(hits.length > 0, true);
  assert.equal(hits[0]?.source, "builtin");
  assert.equal(hits.some((hit) => hit.id === "spacetimedb/rust-reducers"), true);
});

test("loadWorkspaceDocs includes README and docs markdown files", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeWorkspaceFile(
      workspaceRoot,
      "README.md",
      "# Workspace Overview\n\nThis project uses reducer-driven gameplay."
    );

    await writeWorkspaceFile(
      workspaceRoot,
      "docs/trading.md",
      "# Trading\n\nUse reducer calls for atomic item exchange."
    );

    const docs = await loadWorkspaceDocs(workspaceRoot);

    assert.equal(docs.length, 2);
    assert.equal(docs.some((doc) => doc.path === "README.md"), true);
    assert.equal(docs.some((doc) => doc.path === "docs/trading.md"), true);
  });
});

test("searchSpacetimeDocs returns workspace hits and respects source filters", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeWorkspaceFile(
      workspaceRoot,
      "docs/quantum.md",
      "# Quantum Trading\n\nThe quantumtrade protocol is implemented through reducers only."
    );

    const allSources = await searchSpacetimeDocs(workspaceRoot, "quantumtrade", {
      source: "all",
      includeWorkspaceDocs: true,
      limit: 5
    });

    assert.equal(allSources.hits.length > 0, true);
    assert.equal(allSources.hits[0]?.source, "workspace");
    assert.equal(allSources.hits[0]?.excerpt.toLowerCase().includes("quantumtrade"), true);

    const builtinOnly = await searchSpacetimeDocs(workspaceRoot, "quantumtrade", {
      source: "builtin",
      includeWorkspaceDocs: true,
      limit: 5
    });

    assert.equal(builtinOnly.hits.length, 0);
  });
});
