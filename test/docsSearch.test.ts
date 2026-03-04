import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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

async function withRemoteDocsServer(
  payload: unknown,
  run: (endpoint: string) => Promise<void>
): Promise<void> {
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }

    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    throw new Error("Failed to start remote docs test server.");
  }

  const endpoint = `http://127.0.0.1:${address.port}/search`;

  try {
    await run(endpoint);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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
    assert.equal(Array.isArray(allSources.warnings), true);
    assert.equal(allSources.remote.attempted, false);
  });
});

test("searchSpacetimeDocs merges remote hits when endpoint is configured", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await withRemoteDocsServer(
      {
        hits: [
          {
            id: "remote/spacetime-cloud",
            title: "Spacetime Cloud Read Models",
            excerpt: "Use read models to hydrate multiplayer clients quickly.",
            score: 300,
            tags: ["cloud", "read-model", "latency"],
            url: "https://docs.example.dev/spacetime-cloud"
          }
        ]
      },
      async (endpoint) => {
        const result = await searchSpacetimeDocs(workspaceRoot, "cloud read model", {
          source: "all",
          includeWorkspaceDocs: false,
          includeRemoteDocs: true,
          remoteEndpoint: endpoint,
          limit: 5
        });

        assert.equal(result.remote.attempted, true);
        assert.equal(result.remote.hitCount, 1);
        assert.equal(result.hits[0]?.source, "remote");
        assert.equal(result.hits[0]?.title, "Spacetime Cloud Read Models");
        assert.equal(result.warnings.length, 0);
      }
    );
  });
});

test("searchSpacetimeDocs returns warning when remote source requested without endpoint", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await searchSpacetimeDocs(workspaceRoot, "anything", {
      source: "remote",
      includeRemoteDocs: true,
      includeWorkspaceDocs: false,
      limit: 3
    });

    assert.equal(result.hits.length, 0);
    assert.equal(result.remote.attempted, true);
    assert.equal(result.warnings.length > 0, true);
    assert.equal(result.warnings[0]?.includes("SPACETIME_MCP_DOCS_API_URL"), true);
  });
});
