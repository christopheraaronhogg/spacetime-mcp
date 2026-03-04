import assert from "node:assert/strict";
import test from "node:test";

import { SPACETIME_MCP_TOOLS } from "../src/mcpToolContract.js";

const EXPECTED_TOOL_NAMES = [
  "get_spacetime_app_info",
  "get_spacetime_schema",
  "get_spacetime_reducers",
  "search_spacetime_symbols",
  "get_spacetime_client_call",
  "get_spacetime_docs",
  "search_spacetime_docs",
  "list_spacetime_skills",
  "get_spacetime_skill"
];

function getTool(name: string) {
  const tool = SPACETIME_MCP_TOOLS.find((entry) => entry.name === name);
  assert.ok(tool, `Expected tool '${name}' to exist in contract.`);
  return tool;
}

test("SPACETIME_MCP_TOOLS exposes stable tool names and order", () => {
  assert.deepEqual(
    SPACETIME_MCP_TOOLS.map((tool) => tool.name),
    EXPECTED_TOOL_NAMES
  );
});

test("SPACETIME_MCP_TOOLS has unique names and strict schemas", () => {
  const names = SPACETIME_MCP_TOOLS.map((tool) => tool.name);
  const uniqueNames = new Set(names);

  assert.equal(uniqueNames.size, names.length);

  for (const tool of SPACETIME_MCP_TOOLS) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test("SPACETIME_MCP_TOOLS keeps required argument contracts for key tools", () => {
  assert.deepEqual(getTool("search_spacetime_symbols").inputSchema.required, ["query"]);
  assert.deepEqual(getTool("get_spacetime_client_call").inputSchema.required, ["reducerName"]);
  assert.deepEqual(getTool("search_spacetime_docs").inputSchema.required, ["query"]);
  assert.deepEqual(getTool("get_spacetime_skill").inputSchema.required, ["skillName"]);
});

test("SPACETIME_MCP_TOOLS keeps enum values for filterable fields", () => {
  const symbolKind = getTool("search_spacetime_symbols").inputSchema.properties.kind as {
    enum: string[];
  };
  const clientTarget = getTool("get_spacetime_client_call").inputSchema.properties.client as {
    enum: string[];
  };
  const docSource = getTool("search_spacetime_docs").inputSchema.properties.source as {
    enum: string[];
  };

  assert.deepEqual(symbolKind.enum, ["all", "table", "reducer"]);
  assert.deepEqual(clientTarget.enum, ["typescript", "csharp", "unity"]);
  assert.deepEqual(docSource.enum, ["all", "builtin", "workspace", "remote"]);
});
