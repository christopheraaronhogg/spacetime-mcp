import assert from "node:assert/strict";
import test from "node:test";

import { buildReducerRefId, buildTableRefId, resolveRefId } from "../src/context/refIds.js";
import type { SpacetimeWorkspaceContext } from "../src/types.js";

const context: SpacetimeWorkspaceContext = {
  tables: [
    {
      name: "Player",
      module: "server/player.rs",
      columns: [
        {
          name: "id",
          type: "u64",
          constraints: ["primary_key"]
        },
        {
          name: "name",
          type: "String",
          constraints: ["index"]
        }
      ]
    }
  ],
  reducers: [
    {
      name: "set_name",
      module: "server/player.rs",
      arguments: [
        {
          name: "id",
          type: "u64"
        },
        {
          name: "name",
          type: "String"
        }
      ]
    }
  ],
  metadata: {
    detectedLanguages: ["rust"],
    filesScanned: ["server/player.rs"],
    directoriesScanned: ["server"],
    generatedAt: new Date().toISOString()
  }
};

test("buildTableRefId and buildReducerRefId are stable", () => {
  const tableRef = buildTableRefId(context.tables[0]);
  const reducerRef = buildReducerRefId(context.reducers[0]);

  assert.match(tableRef, /^tbl_[a-f0-9]{10}$/);
  assert.match(reducerRef, /^red_[a-f0-9]{10}$/);

  assert.equal(tableRef, buildTableRefId(context.tables[0]));
  assert.equal(reducerRef, buildReducerRefId(context.reducers[0]));
});

test("resolveRefId resolves table and reducer ids", () => {
  const tableRef = buildTableRefId(context.tables[0]);
  const reducerRef = buildReducerRefId(context.reducers[0]);

  const tableTarget = resolveRefId(context, tableRef);
  assert.deepEqual(tableTarget, {
    kind: "table",
    table: context.tables[0]
  });

  const reducerTarget = resolveRefId(context, reducerRef);
  assert.deepEqual(reducerTarget, {
    kind: "reducer",
    reducer: context.reducers[0]
  });

  assert.equal(resolveRefId(context, "tbl_missing"), null);
});
