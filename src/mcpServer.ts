import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { buildReducerClientUsage } from "./context/clientInvocation.js";
import { findReducerByName, formatReducerSignature, searchSymbols } from "./context/contextQuery.js";
import { searchSpacetimeDocs } from "./context/docsSearch.js";
import { getSpacetimeDocsMarkdown } from "./context/spacetimeDocs.js";
import {
  findWorkspaceSkill,
  listWorkspaceSkills,
  loadWorkspaceGuidelines
} from "./context/workspaceKnowledge.js";
import { SPACETIME_MCP_TOOLS } from "./mcpToolContract.js";
import type { ClientTarget, SpacetimeDocSource, SpacetimeSymbolType } from "./types.js";
import { WorkspaceContextStore } from "./introspection/workspaceContextStore.js";
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

function textContent(text: string): { content: [{ type: "text"; text: string }] } {
  return {
    content: [
      {
        type: "text",
        text
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

export function createSpacetimeMcpServer(workspaceRoot: string): Server {
  const contextStore = new WorkspaceContextStore(workspaceRoot);

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

    try {
      if (name === "get_spacetime_app_info") {
        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const moduleSet = new Set([
          ...context.tables.map((table) => table.module),
          ...context.reducers.map((reducer) => reducer.module)
        ]);

        return jsonContent({
          workspaceRoot,
          summary: {
            tableCount: context.tables.length,
            reducerCount: context.reducers.length,
            moduleCount: moduleSet.size,
            scannedFileCount: context.metadata.filesScanned.length
          },
          metadata: context.metadata,
          cache: {
            hit: cacheHit,
            fingerprint
          }
        });
      }

      if (name === "get_spacetime_schema") {
        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const tableName = asOptionalString(args.tableName);
        const contains = asOptionalString(args.contains)?.toLowerCase();
        const limit = asOptionalNumber(args.limit, 1, 200) ?? 50;

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

        const limitedTables = tables.slice(0, limit);

        return jsonContent({
          workspaceRoot,
          totalTables: context.tables.length,
          matchedTables: tables.length,
          returnedTables: limitedTables.length,
          tables: limitedTables,
          cache: {
            hit: cacheHit,
            fingerprint
          }
        });
      }

      if (name === "get_spacetime_reducers") {
        const { context, cacheHit, fingerprint } = await contextStore.getContext({ forceRefresh });
        const reducerName = asOptionalString(args.reducerName);
        const contains = asOptionalString(args.contains)?.toLowerCase();
        const limit = asOptionalNumber(args.limit, 1, 200) ?? 50;

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

        const limitedReducers = reducers.slice(0, limit);

        return jsonContent({
          workspaceRoot,
          totalReducers: context.reducers.length,
          matchedReducers: reducers.length,
          returnedReducers: limitedReducers.length,
          reducers: limitedReducers,
          cache: {
            hit: cacheHit,
            fingerprint
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

        return jsonContent({
          workspaceRoot,
          query,
          kind,
          matchCount: matches.length,
          matches,
          cache: {
            hit: cacheHit,
            fingerprint
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

        return jsonContent({
          workspaceRoot,
          reducer: {
            name: reducer.name,
            module: reducer.module,
            signature: formatReducerSignature(reducer)
          },
          usage,
          cache: {
            hit: cacheHit,
            fingerprint
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
        const markdown = getSpacetimeDocsMarkdown({
          additionalGuidelines: workspaceGuidelines,
          skills: workspaceSkills
        });

        return textContent(markdown);
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

        return jsonContent({
          workspaceRoot,
          query,
          source,
          includeWorkspaceDocs,
          includeRemoteDocs: includeRemoteDocs ?? source === "remote",
          remoteEndpoint: remoteEndpoint ?? process.env.SPACETIME_MCP_DOCS_API_URL,
          remoteTimeoutMs: remoteTimeoutMs ?? 2500,
          documentsIndexed: result.documentsIndexed,
          hitCount: result.hits.length,
          warnings: result.warnings,
          remote: result.remote,
          hits: result.hits
        });
      }

      if (name === "list_spacetime_skills") {
        const skills = await listWorkspaceSkills(workspaceRoot);
        return jsonContent({
          workspaceRoot,
          skillCount: skills.length,
          skills: skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            path: skill.path
          }))
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

        return textContent(skill.content);
      }

      return errorContent(`Unknown tool: ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorContent(`Tool ${name} failed: ${message}`);
    }
  });

  return server;
}
