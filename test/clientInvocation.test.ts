import assert from "node:assert/strict";
import test from "node:test";

import { buildReducerClientUsage } from "../src/context/clientInvocation.js";
import type { ReducerSchema } from "../src/types.js";

const reducer: ReducerSchema = {
  name: "trade_item",
  module: "server/trade.rs",
  arguments: [
    { name: "from_player_id", type: "u64" },
    { name: "to_player_id", type: "u64" },
    { name: "item_id", type: "u64" },
    { name: "note", type: "Option<String>" }
  ]
};

test("buildReducerClientUsage creates TypeScript invocation guidance", () => {
  const usage = buildReducerClientUsage(reducer, "typescript");

  assert.equal(usage.client, "typescript");
  assert.equal(
    usage.invocation,
    "await client.reducers.tradeItem(from_player_id, to_player_id, item_id, note);"
  );
  assert.equal(
    usage.alternatives.includes(
      "await client.reducers.trade_item(from_player_id, to_player_id, item_id, note);"
    ),
    true
  );
});

test("buildReducerClientUsage creates C# and Unity invocation guidance", () => {
  const csharpUsage = buildReducerClientUsage(reducer, "csharp");
  const unityUsage = buildReducerClientUsage(reducer, "unity");

  assert.equal(
    csharpUsage.invocation,
    "await connection.Reducers.TradeItem(from_player_id, to_player_id, item_id, note);"
  );
  assert.equal(
    unityUsage.invocation,
    "await connection.Reducers.TradeItem(from_player_id, to_player_id, item_id, note);"
  );
});
