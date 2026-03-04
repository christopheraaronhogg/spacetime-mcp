import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { getSpacetimeDocsMarkdown } from "./context/spacetimeDocs.js";
import { scanWorkspace } from "./introspection/workspaceScanner.js";

type ToolArgs = Record<string, unknown>;

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function createSpacetimeMcpServer(workspaceRoot: string): Server {
  const server = new Server(
    {
      name: "spacetime-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_spacetime_schema",
          description: "Return parsed SpacetimeDB tables, columns, and constraints from the workspace.",
          inputSchema: {
            type: "object",
            properties: {
              tableName: {
                type: "string",
                description: "Optional table name filter."
              }
            },
            additionalProperties: false
          }
        },
        {
          name: "get_spacetime_reducers",
          description: "Return parsed reducers and argument signatures from the workspace.",
          inputSchema: {
            type: "object",
            properties: {
              reducerName: {
                type: "string",
                description: "Optional reducer name filter."
              }
            },
            additionalProperties: false
          }
        },
        {
          name: "get_spacetime_docs",
          description: "Return core SpacetimeDB paradigm rules to ground the LLM.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as ToolArgs;

    try {
      if (name === "get_spacetime_schema") {
        const context = await scanWorkspace(workspaceRoot);
        const tableName = asOptionalString(args.tableName);
        const tables = tableName
          ? context.tables.filter((table) => table.name.toLowerCase() === tableName.toLowerCase())
          : context.tables;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ workspaceRoot, tables }, null, 2)
            }
          ]
        };
      }

      if (name === "get_spacetime_reducers") {
        const context = await scanWorkspace(workspaceRoot);
        const reducerName = asOptionalString(args.reducerName);
        const reducers = reducerName
          ? context.reducers.filter(
              (reducer) => reducer.name.toLowerCase() === reducerName.toLowerCase()
            )
          : context.reducers;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ workspaceRoot, reducers }, null, 2)
            }
          ]
        };
      }

      if (name === "get_spacetime_docs") {
        return {
          content: [
            {
              type: "text",
              text: getSpacetimeDocsMarkdown()
            }
          ]
        };
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool ${name} failed: ${message}`
          }
        ]
      };
    }
  });

  return server;
}
