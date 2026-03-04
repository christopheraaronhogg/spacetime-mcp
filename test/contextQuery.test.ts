import assert from "node:assert/strict";
import test from "node:test";

import { findReducerByName, findTableByName, searchSymbols } from "../src/context/contextQuery.js";
import type { SpacetimeWorkspaceContext } from "../src/types.js";

const fixtureContext: SpacetimeWorkspaceContext = {
  tables: [
    {
      name: "PlayerInventory",
      module: "server/inventory.rs",
      columns: [
        { name: "id", type: "u64", constraints: ["primary_key"] },
        { name: "owner_id", type: "u64", constraints: ["index"] }
      ]
    },
    {
      name: "TradeOffer",
      module: "server/trade.rs",
      columns: [{ name: "id", type: "u64", constraints: ["primary_key"] }]
    }
  ],
  reducers: [
    {
      name: "create_trade_offer",
      module: "server/trade.rs",
      arguments: [
        { name: "from", type: "u64" },
        { name: "to", type: "u64" }
      ]
    },
    {
      name: "accept_trade_offer",
      module: "server/trade.rs",
      arguments: [{ name: "offer_id", type: "u64" }]
    }
  ],
  metadata: {
    detectedLanguages: ["rust"],
    filesScanned: ["server/inventory.rs", "server/trade.rs"],
    directoriesScanned: ["server"],
    generatedAt: "2026-03-04T00:00:00.000Z"
  }
};

test("searchSymbols ranks exact matches before partial matches", () => {
  const matches = searchSymbols(fixtureContext, "create_trade_offer", "all", 10);

  assert.equal(matches.length >= 1, true);
  assert.equal(matches[0]?.kind, "reducer");
  assert.equal(matches[0]?.name, "create_trade_offer");
});

test("searchSymbols supports kind filtering", () => {
  const tableOnly = searchSymbols(fixtureContext, "trade", "table", 10);
  assert.equal(tableOnly.every((match) => match.kind === "table"), true);
  assert.equal(tableOnly.some((match) => match.name === "TradeOffer"), true);

  const reducerOnly = searchSymbols(fixtureContext, "trade", "reducer", 10);
  assert.equal(reducerOnly.every((match) => match.kind === "reducer"), true);
  assert.equal(reducerOnly.some((match) => match.name === "accept_trade_offer"), true);
});

test("findTableByName and findReducerByName are case-insensitive", () => {
  const table = findTableByName(fixtureContext, "playerinventory");
  const reducer = findReducerByName(fixtureContext, "ACCEPT_TRADE_OFFER");

  assert.equal(table?.name, "PlayerInventory");
  assert.equal(reducer?.name, "accept_trade_offer");
});
