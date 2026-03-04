import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";

import { WorkspaceContextStore } from "../src/introspection/workspaceContextStore.js";

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-store-test-"));

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

test("WorkspaceContextStore returns cache hits and invalidates on file changes", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const reducerFile = "server/trade.rs";

    await writeWorkspaceFile(
      workspaceRoot,
      reducerFile,
      `
#[spacetimedb(reducer)]
pub fn trade_item(ctx: &ReducerContext, from: u64, to: u64) {
}
`
    );

    const store = new WorkspaceContextStore(workspaceRoot);

    const first = await store.getContext();
    assert.equal(first.cacheHit, false);
    assert.equal(first.context.reducers.length, 1);

    const second = await store.getContext();
    assert.equal(second.cacheHit, true);
    assert.equal(second.context.reducers.length, 1);

    await wait(20);

    await writeWorkspaceFile(
      workspaceRoot,
      reducerFile,
      `
#[spacetimedb(reducer)]
pub fn trade_item(ctx: &ReducerContext, from: u64, to: u64) {
}

#[spacetimedb(reducer)]
pub fn accept_trade(ctx: &ReducerContext, trade_id: u64) {
}
`
    );

    const third = await store.getContext();
    assert.equal(third.cacheHit, false);
    assert.equal(third.context.reducers.length, 2);
  });
});
