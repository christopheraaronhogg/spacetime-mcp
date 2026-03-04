import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { WorkspaceArtifactStore } from "./context/artifactStore.js";
import { buildReducerClientUsage } from "./context/clientInvocation.js";
import { findReducerByName, formatReducerSignature, searchSymbols } from "./context/contextQuery.js";
import { searchSpacetimeDocs } from "./context/docsSearch.js";
import { buildReducerRefId, buildTableRefId, resolveRefId } from "./context/refIds.js";
import { getBuiltinGuidelines, getSpacetimeDocsMarkdown } from "./context/spacetimeDocs.js";
import {
  findWorkspaceSkill,
  listWorkspaceSkills,
  loadWorkspaceGuidelines
} from "./context/workspaceKnowledge.js";
import { WorkspaceContextStore } from "./introspection/workspaceContextStore.js";
import { SPACETIME_MCP_TOOLS } from "./mcpToolContract.js";
import type {
  ClientTarget,
  SpacetimeDataResolution,
  SpacetimeDocSource,
  SpacetimeResponseMode,
  SpacetimeSymbolType
} from "./types.js";
import { SPACETIME_MCP_VERSION } from "./version.js";

type ToolArgs = Record<string, unknown>;

const SUPPORTED_CLIENTS: ClientTarget[] = ["typescript", "csharp", "unity"];
const SUPPORTED_DOC_SOURCES: Array<SpacetimeDocSource | "all"> = [
  "all",
  "builtin",
  "workspace",
  "remote"
];
const SUPPORTED_SYMBOL_KINDS: Array<SpacetimeSymbolType | "all"> = ["all", "table", "reducer"];
const SUPPORTED_RESOLUTIONS: SpacetimeDataResolution[] = ["minimal", "summary", "full"];
const SUPPORTED_RESPONSE_MODES: SpacetimeResponseMode[] = ["inline", "artifact"];

const DEFAULT_MAX_INLINE_CHARS = 6000;
const DEFAULT_SCHEMA_LIMIT: Record<SpacetimeDataResolution, number> = {
  minimal: 25,
  summary: 40,
  full: 50
};
const DEFAULT_REDUCER_LIMIT: Record<SpacetimeDataResolution, number> = {
  minimal: 25,
  summary: 40,
  full: 50
};

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function asSymbolKind(value: unknown): SpacetimeSymbolType | "all" {
  return typeof value === "string" && SUPPORTED_SYMBOL_KINDS.includes(value as SpacetimeSymbolType)
    ? (value as SpacetimeSymbolType | "all")
    : "all";
}

function asClientTarget(value: unknown): ClientTarget {
  return typeof value === "string" && SUPPORTED_CLIENTS.includes(value as ClientTarget)
    ? (value as ClientTarget)
    : "typescript";
}

function asDocSource(value: unknown): SpacetimeDocSource | "all" {
  return typeof value === "string" && SUPPORTED_DOC_SOURCES.includes(value as SpacetimeDocSource)
    ? (value as SpacetimeDocSource | "all")
    : "all";
}

function asResolution(value: unknown): SpacetimeDataResolution {
  return typeof value === "string" && SUPPORTED_RESOLUTIONS.includes(value as SpacetimeDataResolution)
    ? (value as SpacetimeDataResolution)
    : "minimal";
}

function asResponseMode(value: unknown): SpacetimeResponseMode {
  return typeof value === "string" && SUPPORTED_RESPONSE_MODES.includes(value as SpacetimeResponseMode)
    ? (value as SpacetimeResponseMode)
    : "inline";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function jsonContent(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function errorContent(message: string): {
  isError: true;
  content: [{ type: "text"; text: string }];
} {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message
      }
    ]
  };
}

function serializePayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  return JSON.stringify(payload ?? null, null, 2);
}

interface BuildTableViewInput {
  name: string;
  module: string;
  columns: Array<{ name: string; type: string; constraints: string[] }>;
}

function summarizeTable(view: BuildTableViewInput, resolution: SpacetimeDataResolution) {
  const refId = buildTableRefId({
    name: view.name,
    module: view.module,
    columns: view.columns
  });
  const constraintCount = view.columns.reduce((sum, column) => sum + column.constraints.length, 0);

  if (resolution === "minimal") {
    return {
      refId,
      name: view.name,
      module: view.module,
      columnCount: view.columns.length,
      constraintCount
    };
  }

  if (resolution === "summary") {
    const columnsPreview = view.columns.slice(0, 8).map((column) => ({
      name: column.name,
      type: column.type,
      constraints: column.constraints
    }));

    return {
      refId,
      name: view.name,
      module: view.module,
      columnCount: view.columns.length,
      columnsPreview,
      hasMoreColumns: view.columns.length > columnsPreview.length,
      constraints: [...new Set(view.columns.flatMap((column) => column.constraints))]
    };
  }

  return {
    refId,
    name: view.name,
    module: view.module,
    columns: view.columns
  };
}

interface BuildReducerViewInput {
  name: string;
  module: string;
  arguments: Array<{ name: string; type: string }>;
}

function summarizeReducer(view: BuildReducerViewInput, resolution: SpacetimeDataResolution) {
  const refId = buildReducerRefId({
    name: view.name,
    module: view.module,
    arguments: view.arguments
  });
  const signature = formatReducerSignature({
    name: view.name,
    module: view.module,
    arguments: view.arguments
  });

  if (resolution === "minimal") {
    return {
      refId,
      name: view.name,
      module: view.module,
      argCount: view.arguments.length
    };
  }

  if (resolution === "summary") {
    const argumentsPreview = view.arguments.slice(0, 8);

    return {
      refId,
      name: view.name,
      module: view.module,
      signature,
      argCount: view.arguments.length,
      argumentsPreview,
      hasMoreArguments: view.arguments.length > argumentsPreview.length
    };
  }

  return {
    refId,
    name: view.name,
    module: view.module,
    signature,
    arguments: view.arguments
  };
}

interface RespondWithModeOptions {
  toolName: string;
  resolution: SpacetimeDataResolution;
  responseMode: SpacetimeResponseMode;
  maxInlineChars: number;
  payload: unknown;
  artifactStore: WorkspaceArtifactStore;
  summary?: unknown;
}

async function respondWithMode(options: RespondWithModeOptions): Promise<{
  content: [{ type: "text"; text: string }];
}> {
  const serialized = serializePayload(options.payload);
  const autoArtifact = serialized.length > options.maxInlineChars;

  if (options.responseMode === "artifact" || autoArtifact) {
    const artifact = await options.artifactStore.saveArtifact({
      toolName: options.toolName,
      resolution: options.resolution,
      payload: options.payload
    });

    return jsonContent({
      responseMode: "artifact",
      resolution: options.resolution,
      reason: options.responseMode === "artifact" ? "explicit-request" : "auto-size-threshold",
      maxInlineChars: options.maxInlineChars,
      inlineCharEstimate: serialized.length,
      summary: options.summary,
      artifact
    });
  }

  return jsonContent({
    responseMode: "inline",
    resolution: options.resolution,
    inlineCharEstimate: serialized.length,
    data: options.payload
  });
}

export function createSpacetimeMcpServer(workspaceRoot: string): Server {
  const contextStore = new WorkspaceContextStore(workspaceRoot);
  const artifactStore = new WorkspaceArtifactStore(workspaceRoot);

  const server = new Server(
    {
      name: "spacetime-mcp",
      version: SPACETIME_MCP_VERSION
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: SPACETIME_MCP_TOOLS
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as ToolArgs;
    const forceRefresh = asOptionalBoolean(args.refresh) ?? false;
    const resolution = asResolution(args.resolution);
    const responseMode = asResponseMode(args.responseMode);
    const maxInlineChars =
      asOptionalNumber(args.maxInlineChars, 500, 20000) ?? DEFAULT_MAX_INLINE_CHARS;

    try {
      if (name === "get_spacetime_app_info") {
        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const moduleSet = new Set([
          ...context.tables.map((table) => table.module),
          ...context.reducers.map((reducer) => reducer.module)
        ]);

        const baseSummary = {
          tableCount: context.tables.length,
          reducerCount: context.reducers.length,
          moduleCount: moduleSet.size,
          scannedFileCount: context.metadata.filesScanned.length
        };

        const modules = [...moduleSet].sort();

        const payload =
          resolution === "minimal"
            ? {
                workspaceRoot,
                summary: baseSummary,
                cache: {
                  hit: cacheHit,
                  fingerprint
                }
              }
            : resolution === "summary"
              ? {
                  workspaceRoot,
                  summary: baseSummary,
                  modules,
                  metadata: {
                    detectedLanguages: context.metadata.detectedLanguages,
                    generatedAt: context.metadata.generatedAt,
                    directoriesScanned: context.metadata.directoriesScanned,
                    filesScannedCount: context.metadata.filesScanned.length
                  },
                  cache: {
                    hit: cacheHit,
                    fingerprint
                  }
                }
              : {
                  workspaceRoot,
                  summary: baseSummary,
                  modules,
                  metadata: context.metadata,
                  cache: {
                    hit: cacheHit,
                    fingerprint
                  }
                };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            workspaceRoot,
            ...baseSummary,
            resolution
          }
        });
      }

      if (name === "get_spacetime_schema") {
        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const tableName = asOptionalString(args.tableName);
        const contains = asOptionalString(args.contains)?.toLowerCase();
        const cursor = asOptionalNumber(args.cursor, 0, 1_000_000) ?? 0;
        const limit =
          asOptionalNumber(args.limit, 1, 200) ?? DEFAULT_SCHEMA_LIMIT[resolution];

        let tables = tableName
          ? context.tables.filter((table) => table.name.toLowerCase() === tableName.toLowerCase())
          : context.tables;

        if (contains) {
          tables = tables.filter(
            (table) =>
              table.name.toLowerCase().includes(contains) ||
              table.module.toLowerCase().includes(contains)
          );
        }

        const pagedTables = tables.slice(cursor, cursor + limit);
        const nextCursor = cursor + pagedTables.length < tables.length ? cursor + pagedTables.length : null;

        const payload = {
          workspaceRoot,
          resolution,
          totalTables: context.tables.length,
          matchedTables: tables.length,
          cursor,
          limit,
          nextCursor,
          returnedTables: pagedTables.length,
          tables: pagedTables.map((table) => summarizeTable(table, resolution)),
          cache: {
            hit: cacheHit,
            fingerprint
          }
        };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            totalTables: context.tables.length,
            matchedTables: tables.length,
            returnedTables: pagedTables.length,
            nextCursor
          }
        });
      }

      if (name === "get_spacetime_reducers") {
        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const reducerName = asOptionalString(args.reducerName);
        const contains = asOptionalString(args.contains)?.toLowerCase();
        const cursor = asOptionalNumber(args.cursor, 0, 1_000_000) ?? 0;
        const limit =
          asOptionalNumber(args.limit, 1, 200) ?? DEFAULT_REDUCER_LIMIT[resolution];

        let reducers = reducerName
          ? context.reducers.filter(
              (reducer) => reducer.name.toLowerCase() === reducerName.toLowerCase()
            )
          : context.reducers;

        if (contains) {
          reducers = reducers.filter(
            (reducer) =>
              reducer.name.toLowerCase().includes(contains) ||
              reducer.module.toLowerCase().includes(contains)
          );
        }

        const pagedReducers = reducers.slice(cursor, cursor + limit);
        const nextCursor =
          cursor + pagedReducers.length < reducers.length ? cursor + pagedReducers.length : null;

        const payload = {
          workspaceRoot,
          resolution,
          totalReducers: context.reducers.length,
          matchedReducers: reducers.length,
          cursor,
          limit,
          nextCursor,
          returnedReducers: pagedReducers.length,
          reducers: pagedReducers.map((reducer) => summarizeReducer(reducer, resolution)),
          cache: {
            hit: cacheHit,
            fingerprint
          }
        };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            totalReducers: context.reducers.length,
            matchedReducers: reducers.length,
            returnedReducers: pagedReducers.length,
            nextCursor
          }
        });
      }

      if (name === "read_spacetime_ref") {
        const refId = asOptionalString(args.refId);
        if (!refId) {
          return errorContent("Tool read_spacetime_ref requires a refId argument.");
        }

        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const target = resolveRefId(context, refId);

        if (!target) {
          return errorContent(`Reference not found: ${refId}`);
        }

        const payload =
          target.kind === "table"
            ? {
                workspaceRoot,
                refId,
                kind: "table",
                item: summarizeTable(target.table, resolution),
                cache: {
                  hit: cacheHit,
                  fingerprint
                }
              }
            : {
                workspaceRoot,
                refId,
                kind: "reducer",
                item: summarizeReducer(target.reducer, resolution),
                cache: {
                  hit: cacheHit,
                  fingerprint
                }
              };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            refId,
            kind: target.kind
          }
        });
      }

      if (name === "search_spacetime_symbols") {
        const query = asOptionalString(args.query);
        if (!query) {
          return errorContent("Tool search_spacetime_symbols requires a non-empty query argument.");
        }

        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const kind = asSymbolKind(args.kind);
        const limit = asOptionalNumber(args.limit, 1, 100) ?? 20;
        const matches = searchSymbols(context, query, kind, limit);

        const tableRefByKey = new Map(
          context.tables.map((table) => [`${table.module}:${table.name}`, buildTableRefId(table)])
        );
        const reducerRefByKey = new Map(
          context.reducers.map((reducer) => [`${reducer.module}:${reducer.name}`, buildReducerRefId(reducer)])
        );

        const normalizedMatches = matches.map((match) => {
          const key = `${match.module}:${match.name}`;
          const refId =
            match.kind === "table" ? tableRefByKey.get(key) ?? null : reducerRefByKey.get(key) ?? null;

          if (resolution === "minimal") {
            return {
              refId,
              kind: match.kind,
              name: match.name,
              module: match.module
            };
          }

          if (resolution === "summary") {
            return {
              refId,
              kind: match.kind,
              name: match.name,
              module: match.module,
              score: match.score,
              signature: match.signature
            };
          }

          return {
            refId,
            ...match
          };
        });

        const payload = {
          workspaceRoot,
          query,
          kind,
          resolution,
          matchCount: normalizedMatches.length,
          matches: normalizedMatches,
          cache: {
            hit: cacheHit,
            fingerprint
          }
        };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            query,
            kind,
            matchCount: normalizedMatches.length
          }
        });
      }

      if (name === "get_spacetime_client_call") {
        const reducerName = asOptionalString(args.reducerName);
        if (!reducerName) {
          return errorContent("Tool get_spacetime_client_call requires a reducerName argument.");
        }

        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const reducer = findReducerByName(context, reducerName);

        if (!reducer) {
          const suggestions = searchSymbols(context, reducerName, "reducer", 5).map(
            (match) => match.name
          );

          return errorContent(
            `Reducer not found: ${reducerName}. Suggestions: ${
              suggestions.length > 0 ? suggestions.join(", ") : "none"
            }`
          );
        }

        const client = asClientTarget(args.client);
        const usage = buildReducerClientUsage(reducer, client);

        const payload =
          resolution === "minimal"
            ? {
                workspaceRoot,
                reducer: {
                  refId: buildReducerRefId(reducer),
                  name: reducer.name,
                  module: reducer.module,
                  signature: formatReducerSignature(reducer)
                },
                client,
                invocation: usage.invocation,
                cache: {
                  hit: cacheHit,
                  fingerprint
                }
              }
            : resolution === "summary"
              ? {
                  workspaceRoot,
                  reducer: {
                    refId: buildReducerRefId(reducer),
                    name: reducer.name,
                    module: reducer.module,
                    signature: formatReducerSignature(reducer)
                  },
                  client,
                  invocation: usage.invocation,
                  arguments: usage.arguments,
                  notes: usage.notes,
                  cache: {
                    hit: cacheHit,
                    fingerprint
                  }
                }
              : {
                  workspaceRoot,
                  reducer: {
                    refId: buildReducerRefId(reducer),
                    name: reducer.name,
                    module: reducer.module,
                    signature: formatReducerSignature(reducer)
                  },
                  usage,
                  cache: {
                    hit: cacheHit,
                    fingerprint
                  }
                };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            reducerName: reducer.name,
            client
          }
        });
      }

      if (name === "get_spacetime_docs") {
        const includeWorkspaceGuidelines = asOptionalBoolean(args.includeWorkspaceGuidelines) ?? true;
        const includeSkills = asOptionalBoolean(args.includeSkills) ?? false;

        const workspaceGuidelines = includeWorkspaceGuidelines
          ? await loadWorkspaceGuidelines(workspaceRoot)
          : [];
        const workspaceSkills = includeSkills ? await listWorkspaceSkills(workspaceRoot) : [];
        const builtinGuidelines = getBuiltinGuidelines();
        const allGuidelines = [...builtinGuidelines, ...workspaceGuidelines];
        const markdown = getSpacetimeDocsMarkdown({
          additionalGuidelines: workspaceGuidelines,
          skills: workspaceSkills
        });

        const payload =
          resolution === "minimal"
            ? {
                workspaceRoot,
                guidelineCount: allGuidelines.length,
                workspaceGuidelineCount: workspaceGuidelines.length,
                skillCount: workspaceSkills.length,
                sections: allGuidelines.map((guideline) => ({
                  id: guideline.id,
                  title: guideline.title,
                  source: guideline.source,
                  path: guideline.path
                }))
              }
            : resolution === "summary"
              ? {
                  workspaceRoot,
                  guidelines: allGuidelines.map((guideline) => ({
                    id: guideline.id,
                    title: guideline.title,
                    source: guideline.source,
                    path: guideline.path,
                    excerpt: truncate(guideline.content.replace(/\s+/g, " "), 220)
                  })),
                  skills: workspaceSkills.map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                    path: skill.path
                  }))
                }
              : {
                  workspaceRoot,
                  markdown,
                  guidelines: allGuidelines,
                  skills: workspaceSkills.map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                    path: skill.path
                  }))
                };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            guidelineCount: allGuidelines.length,
            skillCount: workspaceSkills.length
          }
        });
      }

      if (name === "search_spacetime_docs") {
        const query = asOptionalString(args.query);
        if (!query) {
          return errorContent("Tool search_spacetime_docs requires a non-empty query argument.");
        }

        const source = asDocSource(args.source);
        const includeWorkspaceDocs = asOptionalBoolean(args.includeWorkspaceDocs) ?? true;
        const includeRemoteDocs = asOptionalBoolean(args.includeRemoteDocs);
        const remoteEndpoint = asOptionalString(args.remoteEndpoint);
        const remoteTimeoutMs = asOptionalNumber(args.remoteTimeoutMs, 500, 10000);
        const limit = asOptionalNumber(args.limit, 1, 50) ?? 8;

        const result = await searchSpacetimeDocs(workspaceRoot, query, {
          source,
          includeWorkspaceDocs,
          includeRemoteDocs,
          remoteEndpoint,
          remoteTimeoutMs,
          limit
        });

        const hits =
          resolution === "minimal"
            ? result.hits.map((hit) => ({
                id: hit.id,
                title: hit.title,
                source: hit.source,
                score: hit.score
              }))
            : result.hits;

        const payload = {
          workspaceRoot,
          query,
          source,
          resolution,
          includeWorkspaceDocs,
          includeRemoteDocs: includeRemoteDocs ?? source === "remote",
          remoteEndpoint: remoteEndpoint ?? process.env.SPACETIME_MCP_DOCS_API_URL,
          remoteTimeoutMs: remoteTimeoutMs ?? 2500,
          documentsIndexed: result.documentsIndexed,
          hitCount: result.hits.length,
          warnings: result.warnings,
          remote: result.remote,
          hits
        };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            query,
            source,
            hitCount: result.hits.length,
            warnings: result.warnings.length
          }
        });
      }

      if (name === "list_spacetime_skills") {
        const skills = await listWorkspaceSkills(workspaceRoot);

        const skillItems =
          resolution === "minimal"
            ? skills.map((skill) => ({
                name: skill.name
              }))
            : resolution === "summary"
              ? skills.map((skill) => ({
                  name: skill.name,
                  description: skill.description,
                  path: skill.path
                }))
              : skills.map((skill) => ({
                  name: skill.name,
                  description: skill.description,
                  path: skill.path,
                  charCount: skill.content.length,
                  preview: truncate(skill.content.replace(/\s+/g, " "), 240)
                }));

        const payload = {
          workspaceRoot,
          resolution,
          skillCount: skills.length,
          skills: skillItems
        };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            skillCount: skills.length
          }
        });
      }

      if (name === "get_spacetime_skill") {
        const skillName = asOptionalString(args.skillName);
        if (!skillName) {
          return errorContent("Tool get_spacetime_skill requires a skillName argument.");
        }

        const skill = await findWorkspaceSkill(workspaceRoot, skillName);
        if (!skill) {
          const skills = await listWorkspaceSkills(workspaceRoot);
          const suggestions = skills
            .map((entry) => entry.name)
            .filter((entry) => entry.toLowerCase().includes(skillName.toLowerCase()))
            .slice(0, 5);

          return errorContent(
            `Skill not found: ${skillName}. Suggestions: ${
              suggestions.length > 0 ? suggestions.join(", ") : "none"
            }`
          );
        }

        const payload =
          resolution === "minimal"
            ? {
                workspaceRoot,
                skill: {
                  name: skill.name,
                  description: skill.description,
                  path: skill.path,
                  charCount: skill.content.length,
                  lineCount: skill.content.split("\n").length
                }
              }
            : resolution === "summary"
              ? {
                  workspaceRoot,
                  skill: {
                    name: skill.name,
                    description: skill.description,
                    path: skill.path,
                    charCount: skill.content.length,
                    lineCount: skill.content.split("\n").length,
                    excerpt: truncate(skill.content.replace(/\s+/g, " "), 480)
                  }
                }
              : {
                  workspaceRoot,
                  skill: {
                    name: skill.name,
                    description: skill.description,
                    path: skill.path,
                    content: skill.content
                  }
                };

        return await respondWithMode({
          toolName: name,
          resolution,
          responseMode,
          maxInlineChars,
          payload,
          artifactStore,
          summary: {
            skillName: skill.name,
            path: skill.path
          }
        });
      }

      if (name === "list_spacetime_artifacts") {
        const limit = asOptionalNumber(args.limit, 1, 200) ?? 20;
        const maxAgeMs = asOptionalNumber(args.maxAgeMs, 1000, 1000 * 60 * 60 * 24 * 30);

        const artifacts = await artifactStore.listArtifacts({
          limit,
          maxAgeMs
        });

        return jsonContent({
          workspaceRoot,
          artifactCount: artifacts.length,
          artifacts
        });
      }

      if (name === "read_spacetime_artifact") {
        const artifactId = asOptionalString(args.artifactId);
        if (!artifactId) {
          return errorContent("Tool read_spacetime_artifact requires an artifactId argument.");
        }

        const offset = asOptionalNumber(args.offset, 0, 10_000_000) ?? 0;
        const limit = asOptionalNumber(args.limit, 200, 20000) ?? 4000;

        const result = await artifactStore.readArtifactChunk(artifactId, {
          offset,
          limit
        });

        if (!result) {
          return errorContent(`Artifact not found: ${artifactId}`);
        }

        return jsonContent({
          workspaceRoot,
          artifact: result.artifact,
          chunk: result.chunk,
          offset: result.offset,
          limit: result.limit,
          nextOffset: result.nextOffset,
          done: result.done,
          totalChars: result.totalChars
        });
      }

      return errorContent(`Unknown tool: ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorContent(`Tool ${name} failed: ${message}`);
    }
  });

  return server;
}

interface LocalCallToolResponse {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

type LocalCallToolHandler = (
  request: {
    method: "tools/call";
    params: {
      name: string;
      arguments?: Record<string, unknown>;
    };
  },
  extra?: unknown
) => Promise<LocalCallToolResponse>;

function getLocalCallToolHandler(server: Server): LocalCallToolHandler {
  const handlers = Reflect.get(server as object, "_requestHandlers") as
    | Map<string, LocalCallToolHandler>
    | undefined;

  const handler = handlers?.get("tools/call");
  if (!handler) {
    throw new Error("tools/call handler is not available on server instance");
  }

  return handler;
}

export interface LocalToolRunResult {
  isError: boolean;
  text: string;
  payload: unknown;
}

export async function runSpacetimeToolLocally(
  workspaceRoot: string,
  toolName: string,
  toolArgs?: Record<string, unknown>
): Promise<LocalToolRunResult> {
  const server = createSpacetimeMcpServer(workspaceRoot);
  const handler = getLocalCallToolHandler(server);

  const response = await handler({
    method: "tools/call",
    params: {
      name: toolName,
      arguments: toolArgs ?? {}
    }
  });

  const text = response.content?.[0]?.text ?? "";

  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  return {
    isError: Boolean(response.isError),
    text,
    payload
  };
}
