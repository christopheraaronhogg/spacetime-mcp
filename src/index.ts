#!/usr/bin/env node

import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { installOrUpdateResources } from "./cli/resourceInstaller.js";
import { createSpacetimeMcpServer } from "./mcpServer.js";
import { SPACETIME_MCP_VERSION } from "./version.js";

type CliCommand = "install" | "update" | "mcp" | "help";

function parseCommand(raw?: string): CliCommand | undefined {
  if (!raw) {
    return undefined;
  }

  if (raw === "install" || raw === "update" || raw === "mcp") {
    return raw;
  }

  if (raw === "help" || raw === "--help" || raw === "-h") {
    return "help";
  }

  return undefined;
}

function printHelp(): void {
  console.log(`spacetime-mcp v${SPACETIME_MCP_VERSION}`);
  console.log("");
  console.log("Usage:");
  console.log("  spacetime-mcp [workspacePath]");
  console.log("  spacetime-mcp mcp [workspacePath]");
  console.log("  spacetime-mcp install [workspacePath]");
  console.log("  spacetime-mcp update [workspacePath]");
}

async function runMcpServer(workspaceRoot: string): Promise<void> {
  const server = createSpacetimeMcpServer(workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runResourceCommand(mode: "install" | "update", workspaceRoot: string): Promise<void> {
  const result = await installOrUpdateResources({
    mode,
    workspaceRoot,
    version: SPACETIME_MCP_VERSION
  });

  console.log(`spacetime-mcp ${mode} complete: ${workspaceRoot}`);

  if (result.created.length > 0) {
    console.log(`created: ${result.created.join(", ")}`);
  }

  if (result.updated.length > 0) {
    console.log(`updated: ${result.updated.join(", ")}`);
  }

  if (result.skipped.length > 0) {
    console.log(
      `skipped: ${result.skipped.map((entry) => `${entry.path} (${entry.reason})`).join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = parseCommand(argv[0]);

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "install" || command === "update") {
    const workspaceRoot = path.resolve(argv[1] ?? process.cwd());
    await runResourceCommand(command, workspaceRoot);
    return;
  }

  if (command === "mcp") {
    const workspaceRoot = path.resolve(argv[1] ?? process.cwd());
    await runMcpServer(workspaceRoot);
    return;
  }

  const workspaceRoot = path.resolve(argv[0] ?? process.cwd());
  await runMcpServer(workspaceRoot);
}

await main();
