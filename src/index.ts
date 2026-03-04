#!/usr/bin/env node

import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  installOrUpdateResources,
  isInstallTarget,
  type InstallTarget
} from "./cli/resourceInstaller.js";
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
  console.log("  spacetime-mcp install [workspacePath] [--target <target>] [--dry-run]");
  console.log("  spacetime-mcp update [workspacePath] [--target <target>] [--dry-run]");
  console.log("");
  console.log("Targets: all, mcp, opencode, codex, antigravity");
}

async function runMcpServer(workspaceRoot: string): Promise<void> {
  const server = createSpacetimeMcpServer(workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

interface ParsedResourceArgs {
  workspaceRoot: string;
  targets: InstallTarget[];
  dryRun: boolean;
}

function parseTargetValues(rawValue: string): InstallTarget[] {
  const parsed = rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new Error("--target requires a non-empty value");
  }

  const invalid = parsed.filter((entry) => !isInstallTarget(entry));
  if (invalid.length > 0) {
    throw new Error(`Invalid target(s): ${invalid.join(", ")}`);
  }

  return parsed as InstallTarget[];
}

function parseResourceCommandArgs(argv: string[]): ParsedResourceArgs {
  const targets: InstallTarget[] = [];
  let dryRun = false;
  let workspacePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token.startsWith("--target=")) {
      targets.push(...parseTargetValues(token.slice("--target=".length)));
      continue;
    }

    if (token === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--target requires a value");
      }

      targets.push(...parseTargetValues(value));
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    }

    if (workspacePath !== undefined) {
      throw new Error(`Unexpected extra argument: ${token}`);
    }

    workspacePath = token;
  }

  return {
    workspaceRoot: path.resolve(workspacePath ?? process.cwd()),
    targets: targets.length > 0 ? [...new Set(targets)] : ["all"],
    dryRun
  };
}

async function runResourceCommand(
  mode: "install" | "update",
  workspaceRoot: string,
  targets: InstallTarget[],
  dryRun: boolean
): Promise<void> {
  const result = await installOrUpdateResources({
    mode,
    workspaceRoot,
    version: SPACETIME_MCP_VERSION,
    targets,
    dryRun
  });

  console.log(
    `spacetime-mcp ${mode}${result.dryRun ? " (dry-run)" : ""} complete: ${workspaceRoot}`
  );
  console.log(`targets: ${result.targets.join(", ")}`);

  if (result.created.length > 0) {
    console.log(`created: ${result.created.join(", ")}`);
  }

  if (result.updated.length > 0) {
    console.log(`updated: ${result.updated.join(", ")}`);
  }

  if (result.unchanged.length > 0) {
    console.log(`unchanged: ${result.unchanged.join(", ")}`);
  }

  if (result.skipped.length > 0) {
    console.log(
      `skipped: ${result.skipped.map((entry) => `${entry.path} (${entry.reason})`).join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    const command = parseCommand(argv[0]);

    if (command === "help") {
      printHelp();
      return;
    }

    if (command === "install" || command === "update") {
      const parsed = parseResourceCommandArgs(argv.slice(1));
      await runResourceCommand(command, parsed.workspaceRoot, parsed.targets, parsed.dryRun);
      return;
    }

    if (command === "mcp") {
      const workspaceRoot = path.resolve(argv[1] ?? process.cwd());
      await runMcpServer(workspaceRoot);
      return;
    }

    const workspaceRoot = path.resolve(argv[0] ?? process.cwd());
    await runMcpServer(workspaceRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`spacetime-mcp failed: ${message}`);
    process.exitCode = 1;
  }
}

await main();
