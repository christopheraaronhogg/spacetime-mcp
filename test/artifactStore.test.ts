import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import { WorkspaceArtifactStore } from "../src/context/artifactStore.js";

test("WorkspaceArtifactStore saves artifacts and reads chunked content", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "spacetime-mcp-artifacts-"));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const store = new WorkspaceArtifactStore(workspaceRoot);

  const artifact = await store.saveArtifact({
    toolName: "get_spacetime_schema",
    resolution: "full",
    payload: {
      hello: "world",
      nested: { count: 2 }
    }
  });

  assert.equal(artifact.toolName, "get_spacetime_schema");
  assert.equal(artifact.resolution, "full");
  assert.equal(artifact.format, "json");
  assert.match(artifact.path, /^\.spacetime-mcp\/artifacts\//);

  const list = await store.listArtifacts();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, artifact.id);

  const firstChunk = await store.readArtifactChunk(artifact.id, { limit: 200 });
  assert.ok(firstChunk);
  assert.equal(firstChunk?.artifact.id, artifact.id);
  assert.equal(firstChunk?.offset, 0);
  assert.equal(firstChunk?.done, true);
  assert.match(firstChunk?.chunk ?? "", /"hello": "world"/);
});

test("WorkspaceArtifactStore cleanup expires old artifacts", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "spacetime-mcp-artifacts-"));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const store = new WorkspaceArtifactStore(workspaceRoot);

  await store.saveArtifact({
    toolName: "get_spacetime_docs",
    resolution: "full",
    payload: "Long markdown text"
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  await store.cleanup(1);

  const list = await store.listArtifacts();
  assert.equal(list.length, 0);
});
