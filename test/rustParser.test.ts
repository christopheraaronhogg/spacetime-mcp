import assert from "node:assert/strict";
import test from "node:test";

import { parseRustModule } from "../src/introspection/rustParser.js";

test("parseRustModule extracts tables, constraints, and reducers", () => {
  const source = `
#[spacetimedb(table)]
#[derive(Clone, Debug)]
pub struct Player {
    #[primary_key]
    pub id: u64,
    #[unique]
    pub handle: String,
    #[index]
    pub clan_id: u64,
    pub(crate) score: i32,
}

#[spacetimedb(table(name = inventory_item))]
struct InventoryItem {
    #[primary_key]
    item_id: u64,
    owner_id: u64,
}

#[spacetimedb(reducer)]
#[allow(clippy::too_many_arguments)]
pub fn create_player(
    ctx: &ReducerContext,
    id: u64,
    handle: String,
) -> Result<(), String> {
    Ok(())
}

#[spacetimedb(reducer(init))]
fn seed_world(
    context: &ReducerContext,
    drops: Vec<String>,
    stats: std::collections::HashMap<String, Vec<u32>>,
    outcome: Option<(u32, String)>,
    flags: [bool; 4],
) {
}

fn helper_not_a_reducer(name: String) {
}
`;

  const parsed = parseRustModule(source, "server/main.rs");

  assert.equal(parsed.tables.length, 2);
  assert.equal(parsed.reducers.length, 2);

  assert.deepEqual(parsed.tables[0], {
    name: "Player",
    module: "server/main.rs",
    columns: [
      { name: "id", type: "u64", constraints: ["primary_key"] },
      { name: "handle", type: "String", constraints: ["unique"] },
      { name: "clan_id", type: "u64", constraints: ["index"] },
      { name: "score", type: "i32", constraints: [] }
    ]
  });

  assert.deepEqual(parsed.tables[1], {
    name: "InventoryItem",
    module: "server/main.rs",
    columns: [
      { name: "item_id", type: "u64", constraints: ["primary_key"] },
      { name: "owner_id", type: "u64", constraints: [] }
    ]
  });

  assert.deepEqual(parsed.reducers[0], {
    name: "create_player",
    module: "server/main.rs",
    arguments: [
      { name: "id", type: "u64" },
      { name: "handle", type: "String" }
    ]
  });

  assert.deepEqual(parsed.reducers[1], {
    name: "seed_world",
    module: "server/main.rs",
    arguments: [
      { name: "drops", type: "Vec<String>" },
      { name: "stats", type: "std::collections::HashMap<String, Vec<u32>>" },
      { name: "outcome", type: "Option<(u32, String)>" },
      { name: "flags", type: "[bool; 4]" }
    ]
  });
});

test("parseRustModule ignores unannotated structs and functions", () => {
  const source = `
pub struct PlainStruct {
  id: u64,
}

pub fn helper(id: u64) {
}
`;

  const parsed = parseRustModule(source, "module/plain.rs");

  assert.deepEqual(parsed, {
    tables: [],
    reducers: []
  });
});
