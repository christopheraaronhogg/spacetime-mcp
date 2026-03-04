export interface SpacetimeMcpToolContract {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

const RESOLUTION_ENUM = ["minimal", "summary", "full"];
const RESPONSE_MODE_ENUM = ["inline", "artifact"];

const resolutionProperty = {
  type: "string",
  enum: RESOLUTION_ENUM,
  description: "Response detail level. Defaults to minimal."
};

const responseModeProperty = {
  type: "string",
  enum: RESPONSE_MODE_ENUM,
  description:
    "Delivery mode. inline returns data directly; artifact stores payload on disk and returns a pointer."
};

const maxInlineCharsProperty = {
  type: "number",
  description:
    "Optional inline character budget before auto-switching to artifact mode (500-20000)."
};

function withReadControls(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    ...properties,
    resolution: resolutionProperty,
    responseMode: responseModeProperty,
    maxInlineChars: maxInlineCharsProperty
  };
}

export const SPACETIME_MCP_TOOLS: SpacetimeMcpToolContract[] = [
  {
    name: "get_spacetime_app_info",
    description:
      "Return workspace-level SpacetimeDB context summary, scan metadata, and cache state.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        refresh: {
          type: "boolean",
          description: "Force a full workspace re-scan before returning data."
        }
      }),
      additionalProperties: false
    }
  },
  {
    name: "get_spacetime_schema",
    description: "Return parsed SpacetimeDB tables, columns, and constraints from the workspace.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        tableName: {
          type: "string",
          description: "Optional table name filter."
        },
        contains: {
          type: "string",
          description: "Optional substring filter against table names or module paths."
        },
        limit: {
          type: "number",
          description: "Maximum number of rows to return (1-200)."
        },
        cursor: {
          type: "number",
          description: "Pagination cursor (0-indexed offset)."
        },
        refresh: {
          type: "boolean",
          description: "Force a full workspace re-scan before returning data."
        }
      }),
      additionalProperties: false
    }
  },
  {
    name: "get_spacetime_reducers",
    description: "Return parsed reducers and argument signatures from the workspace.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        reducerName: {
          type: "string",
          description: "Optional reducer name filter."
        },
        contains: {
          type: "string",
          description: "Optional substring filter against reducer names or module paths."
        },
        limit: {
          type: "number",
          description: "Maximum number of rows to return (1-200)."
        },
        cursor: {
          type: "number",
          description: "Pagination cursor (0-indexed offset)."
        },
        refresh: {
          type: "boolean",
          description: "Force a full workspace re-scan before returning data."
        }
      }),
      additionalProperties: false
    }
  },
  {
    name: "read_spacetime_ref",
    description:
      "Resolve a stable table/reducer refId and return that object at the requested resolution.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        refId: {
          type: "string",
          description: "Stable ref id from schema/reducer/search responses (tbl_* or red_*)."
        },
        refresh: {
          type: "boolean",
          description: "Force a full workspace re-scan before resolving refId."
        }
      }),
      required: ["refId"],
      additionalProperties: false
    }
  },
  {
    name: "search_spacetime_symbols",
    description: "Search table and reducer symbols by name or module path with lightweight scoring.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        query: {
          type: "string",
          description: "Search query string."
        },
        kind: {
          type: "string",
          enum: ["all", "table", "reducer"],
          description: "Symbol type filter."
        },
        limit: {
          type: "number",
          description: "Maximum number of matches to return (1-100)."
        },
        refresh: {
          type: "boolean",
          description: "Force a full workspace re-scan before returning data."
        }
      }),
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "get_spacetime_client_call",
    description: "Return client SDK invocation guidance for a reducer.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        reducerName: {
          type: "string",
          description: "Reducer name to resolve."
        },
        client: {
          type: "string",
          enum: ["typescript", "csharp", "unity"],
          description: "Target client runtime for invocation examples."
        },
        refresh: {
          type: "boolean",
          description: "Force a full workspace re-scan before returning data."
        }
      }),
      required: ["reducerName"],
      additionalProperties: false
    }
  },
  {
    name: "get_spacetime_docs",
    description:
      "Return built-in SpacetimeDB grounding docs plus optional workspace guidelines and skills.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        includeWorkspaceGuidelines: {
          type: "boolean",
          description: "Include markdown guidelines from .ai/guidelines and .spacetime/guidelines."
        },
        includeSkills: {
          type: "boolean",
          description: "Include available skill names from .ai/skills."
        }
      }),
      additionalProperties: false
    }
  },
  {
    name: "search_spacetime_docs",
    description: "Search built-in and workspace SpacetimeDB docs with ranked excerpts.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        query: {
          type: "string",
          description: "Documentation search query."
        },
        source: {
          type: "string",
          enum: ["all", "builtin", "workspace", "remote"],
          description: "Filter search results by source."
        },
        limit: {
          type: "number",
          description: "Maximum number of matches to return (1-50)."
        },
        includeWorkspaceDocs: {
          type: "boolean",
          description: "Include markdown docs from the local workspace in the search index."
        },
        includeRemoteDocs: {
          type: "boolean",
          description: "Include remote docs API hits in the result set."
        },
        remoteEndpoint: {
          type: "string",
          description:
            "Optional remote docs API endpoint. Defaults to SPACETIME_MCP_DOCS_API_URL env var."
        },
        remoteTimeoutMs: {
          type: "number",
          description: "Remote docs request timeout in milliseconds (500-10000)."
        }
      }),
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "list_spacetime_skills",
    description: "List available on-demand skills from .ai/skills.",
    inputSchema: {
      type: "object",
      properties: withReadControls({}),
      additionalProperties: false
    }
  },
  {
    name: "get_spacetime_skill",
    description: "Return full markdown content for one workspace skill.",
    inputSchema: {
      type: "object",
      properties: withReadControls({
        skillName: {
          type: "string",
          description: "Skill name from list_spacetime_skills."
        }
      }),
      required: ["skillName"],
      additionalProperties: false
    }
  },
  {
    name: "list_spacetime_artifacts",
    description: "List recent disk-backed artifacts created by MCP tool responses.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum artifacts to return (1-200)."
        },
        maxAgeMs: {
          type: "number",
          description: "Override cleanup retention window in milliseconds."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "read_spacetime_artifact",
    description: "Read an artifact payload by chunk using artifactId.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: {
          type: "string",
          description: "Artifact id from an artifact-mode response."
        },
        offset: {
          type: "number",
          description: "Character offset to begin reading from."
        },
        limit: {
          type: "number",
          description: "Maximum characters to return in this chunk (200-20000)."
        }
      },
      required: ["artifactId"],
      additionalProperties: false
    }
  }
];
