import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { scanWorkspace } from "../src/introspection/workspaceScanner.js";

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-test-"));

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

test("scanWorkspace scans primary SpacetimeDB directories", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeWorkspaceFile(
      workspaceRoot,
      "server/game/main.rs",
      `
#[spacetimedb(table)]
pub struct Player {
  #[primary_key]
  id: u64,
}

#[spacetimedb(reducer)]
pub fn spawn_player(ctx: &ReducerContext, id: u64) {
}
`
    );

    await writeWorkspaceFile(
      workspaceRoot,
      "module/trade.rs",
      `
#[spacetimedb(reducer)]
pub fn trade_item(ctx: &ReducerContext, from: u64, to: u64, item_id: u64) {
}
`
    );

    await writeWorkspaceFile(
      workspaceRoot,
      "root_only.rs",
      `
#[spacetimedb(table)]
pub struct IgnoredAtRoot {
  id: u64,
}
`
    );

    const context = await scanWorkspace(workspaceRoot);

    assert.equal(context.tables.length, 1);
    assert.equal(context.tables[0]?.name, "Player");
    assert.equal(context.tables[0]?.module, "server/game/main.rs");

    const reducerNames = context.reducers.map((reducer) => reducer.name).sort();
    assert.deepEqual(reducerNames, ["spawn_player", "trade_item"]);
    assert.equal(
      context.reducers.some((reducer) => reducer.module === "module/trade.rs"),
      true
    );
    assert.equal(context.tables.some((table) => table.name === "IgnoredAtRoot"), false);
  });
});

test("scanWorkspace falls back to workspace root when standard directories are missing", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeWorkspaceFile(
      workspaceRoot,
      "db.rs",
      `
#[spacetimedb(table)]
pub struct RootTable {
  #[primary_key]
  id: u64,
}
`
    );

    const context = await scanWorkspace(workspaceRoot);

    assert.equal(context.tables.length, 1);
    assert.equal(context.tables[0]?.name, "RootTable");
    assert.equal(context.tables[0]?.module, "db.rs");
    assert.equal(context.reducers.length, 0);
  });
});
