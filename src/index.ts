#!/usr/bin/env node

import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  installOrUpdateResources,
  isInstallTarget,
  type InstallResourcesResult,
  type InstallTarget
} from "./cli/resourceInstaller.js";
import { createSpacetimeMcpServer, runSpacetimeToolLocally } from "./mcpServer.js";
import { SPACETIME_MCP_VERSION } from "./version.js";

type CliCommand = "install" | "update" | "mcp" | "query" | "help";
type CliErrorCode =
  | "ERR_UNKNOWN_OPTION"
  | "ERR_MISSING_OPTION_VALUE"
  | "ERR_INVALID_TARGET"
  | "ERR_INVALID_QUERY"
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

  if (raw === "install" || raw === "update" || raw === "mcp" || raw === "query") {
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
  console.log("  spacetime-mcp query <subject> [--workspace <path>] [options]");
  console.log("");
  console.log("Targets: all, mcp, opencode, codex, antigravity");
  console.log(
    "Query subjects: app, schema, reducers, ref, symbols, call, docs, docs-search, skills, skill, artifacts, artifact, scout"
  );
  console.log("Query defaults: resolution=minimal, responseMode=inline");
  console.log("Example: spacetime-mcp query schema --contains player --summary --artifact");
  console.log("Agent shortcut: spacetime-mcp query scout --workspace /path/to/project");
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

const QUERY_SUBJECT_TO_TOOL: Record<string, string> = {
  app: "get_spacetime_app_info",
  schema: "get_spacetime_schema",
  reducers: "get_spacetime_reducers",
  ref: "read_spacetime_ref",
  symbols: "search_spacetime_symbols",
  call: "get_spacetime_client_call",
  docs: "get_spacetime_docs",
  "docs-search": "search_spacetime_docs",
  skills: "list_spacetime_skills",
  skill: "get_spacetime_skill",
  artifacts: "list_spacetime_artifacts",
  artifact: "read_spacetime_artifact",
  scout: "get_spacetime_app_info",
  overview: "get_spacetime_app_info"
};

const QUERY_RESOLUTIONS = new Set(["minimal", "summary", "full"]);
const QUERY_RESPONSE_MODES = new Set(["inline", "artifact"]);
const QUERY_SYMBOL_KINDS = new Set(["all", "table", "reducer"]);
const QUERY_CLIENTS = new Set(["typescript", "csharp", "unity"]);
const QUERY_DOC_SOURCES = new Set(["all", "builtin", "workspace", "remote"]);

interface ParsedQueryArgs {
  subject: string;
  toolName: string;
  workspaceRoot: string;
  toolArgs: Record<string, unknown>;
  outputJson: boolean;
}

function parseRequiredValue(argv: string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throwCliError("ERR_MISSING_OPTION_VALUE", `${option} requires a value`);
  }

  return [value, index + 1];
}

function parseNumberValue(rawValue: string, option: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throwCliError("ERR_INVALID_QUERY", `${option} requires a numeric value`);
  }

  return parsed;
}

function setResolution(toolArgs: Record<string, unknown>, value: string): void {
  if (!QUERY_RESOLUTIONS.has(value)) {
    throwCliError("ERR_INVALID_QUERY", `Invalid resolution: ${value}`);
  }

  toolArgs.resolution = value;
}

function setResponseMode(toolArgs: Record<string, unknown>, value: string): void {
  if (!QUERY_RESPONSE_MODES.has(value)) {
    throwCliError("ERR_INVALID_QUERY", `Invalid response mode: ${value}`);
  }

  toolArgs.responseMode = value;
}

function resolveQueryToolName(subject: string): string {
  const normalized = subject.trim().toLowerCase();
  if (normalized.length === 0) {
    throwCliError("ERR_INVALID_QUERY", "query requires a subject");
  }

  if (QUERY_SUBJECT_TO_TOOL[normalized]) {
    return QUERY_SUBJECT_TO_TOOL[normalized];
  }

  if (normalized.startsWith("get_spacetime_") || normalized.startsWith("read_spacetime_") || normalized.startsWith("search_spacetime_") || normalized.startsWith("list_spacetime_")) {
    return normalized;
  }

  throwCliError("ERR_INVALID_QUERY", `Unknown query subject: ${subject}`);
}

function parseQueryCommandArgs(argv: string[]): ParsedQueryArgs {
  const subject = argv[0];
  if (!subject) {
    throwCliError("ERR_INVALID_QUERY", "query requires a subject (example: schema, reducers, symbols)");
  }

  const toolName = resolveQueryToolName(subject);
  let workspacePath: string | undefined;
  let outputJson = false;
  const toolArgs: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--json") {
      outputJson = true;
      continue;
    }

    if (token === "--refresh") {
      toolArgs.refresh = true;
      continue;
    }

    if (token === "--artifact") {
      toolArgs.responseMode = "artifact";
      continue;
    }

    if (token === "--summary") {
      toolArgs.resolution = "summary";
      continue;
    }

    if (token === "--full") {
      toolArgs.resolution = "full";
      continue;
    }

    if (token === "--minimal") {
      toolArgs.resolution = "minimal";
      continue;
    }

    if (token === "--include-remote-docs") {
      toolArgs.includeRemoteDocs = true;
      continue;
    }

    if (token === "--no-workspace-docs") {
      toolArgs.includeWorkspaceDocs = false;
      continue;
    }

    if (token === "--include-skills") {
      toolArgs.includeSkills = true;
      continue;
    }

    if (token === "--no-workspace-guidelines") {
      toolArgs.includeWorkspaceGuidelines = false;
      continue;
    }

    if (token.startsWith("--workspace=")) {
      workspacePath = token.slice("--workspace=".length);
      continue;
    }

    if (token.startsWith("--resolution=")) {
      setResolution(toolArgs, token.slice("--resolution=".length));
      continue;
    }

    if (token.startsWith("--response-mode=")) {
      setResponseMode(toolArgs, token.slice("--response-mode=".length));
      continue;
    }

    if (token.startsWith("--max-inline-chars=")) {
      toolArgs.maxInlineChars = parseNumberValue(
        token.slice("--max-inline-chars=".length),
        "--max-inline-chars"
      );
      continue;
    }

    if (token.startsWith("--limit=")) {
      toolArgs.limit = parseNumberValue(token.slice("--limit=".length), "--limit");
      continue;
    }

    if (token.startsWith("--cursor=")) {
      toolArgs.cursor = parseNumberValue(token.slice("--cursor=".length), "--cursor");
      continue;
    }

    if (token.startsWith("--offset=")) {
      toolArgs.offset = parseNumberValue(token.slice("--offset=".length), "--offset");
      continue;
    }

    if (token.startsWith("--max-age-ms=")) {
      toolArgs.maxAgeMs = parseNumberValue(token.slice("--max-age-ms=".length), "--max-age-ms");
      continue;
    }

    if (token.startsWith("--remote-timeout-ms=")) {
      toolArgs.remoteTimeoutMs = parseNumberValue(
        token.slice("--remote-timeout-ms=".length),
        "--remote-timeout-ms"
      );
      continue;
    }

    if (token.startsWith("--contains=")) {
      toolArgs.contains = token.slice("--contains=".length);
      continue;
    }

    if (token.startsWith("--table=")) {
      toolArgs.tableName = token.slice("--table=".length);
      continue;
    }

    if (token.startsWith("--reducer=")) {
      toolArgs.reducerName = token.slice("--reducer=".length);
      continue;
    }

    if (token.startsWith("--query=")) {
      toolArgs.query = token.slice("--query=".length);
      continue;
    }

    if (token.startsWith("--kind=")) {
      const value = token.slice("--kind=".length);
      if (!QUERY_SYMBOL_KINDS.has(value)) {
        throwCliError("ERR_INVALID_QUERY", `Invalid symbol kind: ${value}`);
      }
      toolArgs.kind = value;
      continue;
    }

    if (token.startsWith("--client=")) {
      const value = token.slice("--client=".length);
      if (!QUERY_CLIENTS.has(value)) {
        throwCliError("ERR_INVALID_QUERY", `Invalid client target: ${value}`);
      }
      toolArgs.client = value;
      continue;
    }

    if (token.startsWith("--source=")) {
      const value = token.slice("--source=".length);
      if (!QUERY_DOC_SOURCES.has(value)) {
        throwCliError("ERR_INVALID_QUERY", `Invalid docs source: ${value}`);
      }
      toolArgs.source = value;
      continue;
    }

    if (token.startsWith("--remote-endpoint=")) {
      toolArgs.remoteEndpoint = token.slice("--remote-endpoint=".length);
      continue;
    }

    if (token.startsWith("--ref=")) {
      toolArgs.refId = token.slice("--ref=".length);
      continue;
    }

    if (token.startsWith("--skill=")) {
      toolArgs.skillName = token.slice("--skill=".length);
      continue;
    }

    if (token.startsWith("--artifact-id=")) {
      toolArgs.artifactId = token.slice("--artifact-id=".length);
      continue;
    }

    if (token === "--workspace") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      workspacePath = value;
      index = nextIndex;
      continue;
    }

    if (token === "--resolution") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      setResolution(toolArgs, value);
      index = nextIndex;
      continue;
    }

    if (token === "--response-mode") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      setResponseMode(toolArgs, value);
      index = nextIndex;
      continue;
    }

    if (token === "--max-inline-chars") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.maxInlineChars = parseNumberValue(value, token);
      index = nextIndex;
      continue;
    }

    if (token === "--limit") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.limit = parseNumberValue(value, token);
      index = nextIndex;
      continue;
    }

    if (token === "--cursor") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.cursor = parseNumberValue(value, token);
      index = nextIndex;
      continue;
    }

    if (token === "--offset") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.offset = parseNumberValue(value, token);
      index = nextIndex;
      continue;
    }

    if (token === "--max-age-ms") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.maxAgeMs = parseNumberValue(value, token);
      index = nextIndex;
      continue;
    }

    if (token === "--contains") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.contains = value;
      index = nextIndex;
      continue;
    }

    if (token === "--table") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.tableName = value;
      index = nextIndex;
      continue;
    }

    if (token === "--reducer") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.reducerName = value;
      index = nextIndex;
      continue;
    }

    if (token === "--query") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.query = value;
      index = nextIndex;
      continue;
    }

    if (token === "--kind") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      if (!QUERY_SYMBOL_KINDS.has(value)) {
        throwCliError("ERR_INVALID_QUERY", `Invalid symbol kind: ${value}`);
      }
      toolArgs.kind = value;
      index = nextIndex;
      continue;
    }

    if (token === "--client") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      if (!QUERY_CLIENTS.has(value)) {
        throwCliError("ERR_INVALID_QUERY", `Invalid client target: ${value}`);
      }
      toolArgs.client = value;
      index = nextIndex;
      continue;
    }

    if (token === "--source") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      if (!QUERY_DOC_SOURCES.has(value)) {
        throwCliError("ERR_INVALID_QUERY", `Invalid docs source: ${value}`);
      }
      toolArgs.source = value;
      index = nextIndex;
      continue;
    }

    if (token === "--remote-endpoint") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.remoteEndpoint = value;
      index = nextIndex;
      continue;
    }

    if (token === "--remote-timeout-ms") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.remoteTimeoutMs = parseNumberValue(value, token);
      index = nextIndex;
      continue;
    }

    if (token === "--ref" || token === "--id") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.refId = value;
      toolArgs.artifactId = value;
      index = nextIndex;
      continue;
    }

    if (token === "--skill" || token === "--name") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.skillName = value;
      index = nextIndex;
      continue;
    }

    if (token === "--artifact-id") {
      const [value, nextIndex] = parseRequiredValue(argv, index, token);
      toolArgs.artifactId = value;
      index = nextIndex;
      continue;
    }

    if (token.startsWith("--")) {
      throwCliError("ERR_UNKNOWN_OPTION", `Unknown option: ${token}`);
    }

    positionals.push(token);
  }

  if (positionals.length > 0) {
    if (toolName === "search_spacetime_symbols" || toolName === "search_spacetime_docs") {
      if (!toolArgs.query) {
        toolArgs.query = positionals.join(" ");
      } else {
        throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
      }
    } else if (toolName === "get_spacetime_schema") {
      if (!toolArgs.tableName) {
        toolArgs.tableName = positionals[0];
      } else {
        throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
      }
    } else if (toolName === "get_spacetime_reducers" || toolName === "get_spacetime_client_call") {
      if (!toolArgs.reducerName) {
        toolArgs.reducerName = positionals[0];
      } else {
        throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
      }
    } else if (toolName === "read_spacetime_ref") {
      if (!toolArgs.refId) {
        toolArgs.refId = positionals[0];
      } else {
        throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
      }
    } else if (toolName === "get_spacetime_skill") {
      if (!toolArgs.skillName) {
        toolArgs.skillName = positionals[0];
      } else {
        throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
      }
    } else if (toolName === "read_spacetime_artifact") {
      if (!toolArgs.artifactId) {
        toolArgs.artifactId = positionals[0];
      } else {
        throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
      }
    } else {
      throwCliError("ERR_UNEXPECTED_ARGUMENT", `Unexpected extra argument: ${positionals.join(" ")}`);
    }
  }

  return {
    subject,
    toolName,
    workspaceRoot: path.resolve(workspacePath ?? process.cwd()),
    toolArgs,
    outputJson
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapInlineData(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  if (payload.responseMode === "inline" && "data" in payload) {
    return payload.data;
  }

  return payload;
}

function toRefId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const refId = value.refId;
  return typeof refId === "string" && refId.length > 0 ? refId : undefined;
}

function buildQueryHints(parsed: ParsedQueryArgs, resultPayload: unknown): string[] {
  const hints: string[] = [];

  if (isRecord(resultPayload) && resultPayload.responseMode === "artifact") {
    const artifact = resultPayload.artifact;
    if (isRecord(artifact) && typeof artifact.id === "string") {
      hints.push(
        `spacetime-mcp query artifact ${artifact.id} --workspace ${parsed.workspaceRoot} --json`
      );
    }
  }

  if (parsed.toolName === "search_spacetime_symbols") {
    const normalized = unwrapInlineData(resultPayload);
    if (isRecord(normalized) && Array.isArray(normalized.matches)) {
      const firstRef = normalized.matches.map((entry) => toRefId(entry)).find((entry) => Boolean(entry));
      if (firstRef) {
        hints.push(`spacetime-mcp query ref ${firstRef} --workspace ${parsed.workspaceRoot} --summary --json`);
      }
    }
  }

  if (parsed.toolName === "get_spacetime_schema") {
    hints.push(
      `spacetime-mcp query schema --workspace ${parsed.workspaceRoot} --summary --limit ${
        typeof parsed.toolArgs.limit === "number" ? Math.max(10, Math.floor(parsed.toolArgs.limit)) : 20
      } --json`
    );
  }

  return hints.slice(0, 3);
}

async function runToolOrThrow(
  workspaceRoot: string,
  toolName: string,
  toolArgs?: Record<string, unknown>
): Promise<unknown> {
  const result = await runSpacetimeToolLocally(workspaceRoot, toolName, toolArgs);

  if (result.isError) {
    throwCliError("ERR_RUNTIME_FAILURE", String(result.payload), 1);
  }

  return result.payload;
}

function normalizePreviewList(value: unknown, limit: number): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry)).slice(0, limit);
}

async function runScoutWorkflow(parsed: ParsedQueryArgs): Promise<unknown> {
  const rawLimit = typeof parsed.toolArgs.limit === "number" ? parsed.toolArgs.limit : 8;
  const previewLimit = Math.max(3, Math.min(Math.floor(rawLimit), 25));

  const baseArgs: Record<string, unknown> = {
    resolution: "minimal",
    responseMode: "inline",
    maxInlineChars: 20000
  };

  const appPayload = await runToolOrThrow(parsed.workspaceRoot, "get_spacetime_app_info", baseArgs);
  const schemaPayload = await runToolOrThrow(parsed.workspaceRoot, "get_spacetime_schema", {
    ...baseArgs,
    limit: previewLimit
  });
  const reducerPayload = await runToolOrThrow(parsed.workspaceRoot, "get_spacetime_reducers", {
    ...baseArgs,
    limit: previewLimit
  });

  const appData = unwrapInlineData(appPayload);
  const schemaData = unwrapInlineData(schemaPayload);
  const reducerData = unwrapInlineData(reducerPayload);

  const schemaRecord = isRecord(schemaData) ? schemaData : {};
  const reducerRecord = isRecord(reducerData) ? reducerData : {};

  const schemaPreview = normalizePreviewList(schemaRecord.tables, previewLimit);
  const reducerPreview = normalizePreviewList(reducerRecord.reducers, previewLimit);

  const firstTableRef = schemaPreview.map((entry) => toRefId(entry)).find((entry) => Boolean(entry));
  const firstReducerRef = reducerPreview.map((entry) => toRefId(entry)).find((entry) => Boolean(entry));

  const next: string[] = [];
  if (firstTableRef) {
    next.push(`spacetime-mcp query ref ${firstTableRef} --workspace ${parsed.workspaceRoot} --summary --json`);
  }
  if (firstReducerRef) {
    next.push(`spacetime-mcp query ref ${firstReducerRef} --workspace ${parsed.workspaceRoot} --summary --json`);
  }
  next.push(`spacetime-mcp query symbols <term> --workspace ${parsed.workspaceRoot} --json`);
  next.push(`spacetime-mcp query docs-search "<question>" --workspace ${parsed.workspaceRoot} --json`);

  return {
    mode: "scout",
    workspaceRoot: parsed.workspaceRoot,
    app: appData,
    schema: {
      previewLimit,
      matchedTables: isRecord(schemaData) && typeof schemaData.matchedTables === "number"
        ? schemaData.matchedTables
        : schemaPreview.length,
      nextCursor: isRecord(schemaData) ? (schemaData.nextCursor ?? null) : null,
      preview: schemaPreview
    },
    reducers: {
      previewLimit,
      matchedReducers: isRecord(reducerData) && typeof reducerData.matchedReducers === "number"
        ? reducerData.matchedReducers
        : reducerPreview.length,
      nextCursor: isRecord(reducerData) ? (reducerData.nextCursor ?? null) : null,
      preview: reducerPreview
    },
    next
  };
}

async function runQueryCommand(parsed: ParsedQueryArgs): Promise<void> {
  const isScoutFlow = parsed.subject === "scout" || parsed.subject === "overview";

  const queryResult = isScoutFlow
    ? await runScoutWorkflow(parsed)
    : await runToolOrThrow(parsed.workspaceRoot, parsed.toolName, parsed.toolArgs);

  const hints = isScoutFlow ? [] : buildQueryHints(parsed, queryResult);

  const payload = {
    ok: true,
    command: "query",
    subject: parsed.subject,
    tool: isScoutFlow ? "workflow.scout" : parsed.toolName,
    workspaceRoot: parsed.workspaceRoot,
    result: queryResult,
    hints
  };

  if (parsed.outputJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
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

    if (command === "query") {
      const parsed = parseQueryCommandArgs(argv.slice(1));
      await runQueryCommand(parsed);
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
