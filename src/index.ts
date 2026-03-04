#!/usr/bin/env node

import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  installOrUpdateResources,
  isInstallTarget,
  type InstallResourcesResult,
  type InstallTarget
} from "./cli/resourceInstaller.js";
import { createSpacetimeMcpServer } from "./mcpServer.js";
import { SPACETIME_MCP_VERSION } from "./version.js";

type CliCommand = "install" | "update" | "mcp" | "help";
type CliErrorCode =
  | "ERR_UNKNOWN_OPTION"
  | "ERR_MISSING_OPTION_VALUE"
  | "ERR_INVALID_TARGET"
  | "ERR_UNEXPECTED_ARGUMENT"
  | "ERR_RUNTIME_FAILURE";

const USAGE_EXIT_CODE = 2;

class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;

  constructor(message: string, code: CliErrorCode, exitCode = USAGE_EXIT_CODE) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function throwCliError(code: CliErrorCode, message: string, exitCode = USAGE_EXIT_CODE): never {
  throw new CliError(message, code, exitCode);
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new CliError(message, "ERR_RUNTIME_FAILURE", 1);
}

function shouldUseJsonOutput(argv: string[]): boolean {
  return argv.includes("--json");
}

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
  console.log("  spacetime-mcp install [workspacePath] [--target <target>] [--dry-run] [--json]");
  console.log("  spacetime-mcp update [workspacePath] [--target <target>] [--dry-run] [--json]");
  console.log("");
  console.log("Targets: all, mcp, opencode, codex, antigravity");
  console.log("Exit codes: 0=success, 1=runtime error, 2=usage error");
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
  outputJson: boolean;
}

function parseTargetValues(rawValue: string): InstallTarget[] {
  const parsed = rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throwCliError("ERR_MISSING_OPTION_VALUE", "--target requires a non-empty value");
  }

  const invalid = parsed.filter((entry) => !isInstallTarget(entry));
  if (invalid.length > 0) {
    throwCliError("ERR_INVALID_TARGET", `Invalid target(s): ${invalid.join(", ")}`);
  }

  return parsed as InstallTarget[];
}

function parseResourceCommandArgs(argv: string[]): ParsedResourceArgs {
  const targets: InstallTarget[] = [];
  let dryRun = false;
  let outputJson = false;
  let workspacePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--json") {
      outputJson = true;
      continue;
    }

    if (token.startsWith("--target=")) {
      targets.push(...parseTargetValues(token.slice("--target=".length)));
      continue;
    }

    if (token === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throwCliError("ERR_MISSING_OPTION_VALUE", "--target requires a value");
      }

      targets.push(...parseTargetValues(value));
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throwCliError("ERR_UNKNOWN_OPTION", `Unknown option: ${token}`);
    }

    if (workspacePath !== undefined) {
      throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${token}`);
    }

    workspacePath = token;
  }

  return {
    workspaceRoot: path.resolve(workspacePath ?? process.cwd()),
    targets: targets.length > 0 ? [...new Set(targets)] : ["all"],
    dryRun,
    outputJson
  };
}

interface ParsedMcpArgs {
  workspaceRoot: string;
}

function parseMcpCommandArgs(argv: string[]): ParsedMcpArgs {
  let workspacePath: string | undefined;

  for (const token of argv) {
    if (token.startsWith("--")) {
      throwCliError("ERR_UNKNOWN_OPTION", `Unknown option: ${token}`);
    }

    if (workspacePath !== undefined) {
      throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${token}`);
    }

    workspacePath = token;
  }

  return {
    workspaceRoot: path.resolve(workspacePath ?? process.cwd())
  };
}

function printResourceResult(
  mode: "install" | "update",
  result: InstallResourcesResult,
  outputJson: boolean
): void {
  if (outputJson) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          command: mode,
          result
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`spacetime-mcp ${mode}${result.dryRun ? " (dry-run)" : ""} complete: ${result.workspaceRoot}`);
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

async function runResourceCommand(
  mode: "install" | "update",
  workspaceRoot: string,
  targets: InstallTarget[],
  dryRun: boolean,
  outputJson: boolean
): Promise<void> {
  const result = await installOrUpdateResources({
    mode,
    workspaceRoot,
    version: SPACETIME_MCP_VERSION,
    targets,
    dryRun
  });

  printResourceResult(mode, result, outputJson);
}

function printCliError(error: CliError, outputJson: boolean): void {
  if (outputJson) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message
          }
        },
        null,
        2
      )
    );
    return;
  }

  console.error(`spacetime-mcp failed [${error.code}]: ${error.message}`);
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
      await runResourceCommand(
        command,
        parsed.workspaceRoot,
        parsed.targets,
        parsed.dryRun,
        parsed.outputJson
      );
      return;
    }

    if (command === "mcp") {
      const parsed = parseMcpCommandArgs(argv.slice(1));
      await runMcpServer(parsed.workspaceRoot);
      return;
    }

    if (argv[0]?.startsWith("--")) {
      throwCliError("ERR_UNKNOWN_OPTION", `Unknown option: ${argv[0]}`);
    }

    const parsed = parseMcpCommandArgs(argv);
    await runMcpServer(parsed.workspaceRoot);
  } catch (error) {
    const cliError = toCliError(error);
    printCliError(cliError, shouldUseJsonOutput(process.argv.slice(2)));
    process.exitCode = cliError.exitCode;
  }
}

await main();
