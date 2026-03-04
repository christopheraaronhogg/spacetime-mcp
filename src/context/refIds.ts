import { createHash } from "node:crypto";

import type {
  ReducerSchema,
  SpacetimeWorkspaceContext,
  TableSchema
} from "../types.js";

export type SpacetimeRefTarget =
  | { kind: "table"; table: TableSchema }
  | { kind: "reducer"; reducer: ReducerSchema };

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

export function buildTableRefId(table: TableSchema): string {
  return `tbl_${shortHash(`${table.module}:${table.name}`)}`;
}

export function buildReducerRefId(reducer: ReducerSchema): string {
  return `red_${shortHash(`${reducer.module}:${reducer.name}`)}`;
}

export function resolveRefId(
  context: SpacetimeWorkspaceContext,
  refId: string
): SpacetimeRefTarget | null {
  const normalized = refId.trim();
  if (normalized.length === 0) {
    return null;
  }

  for (const table of context.tables) {
    if (buildTableRefId(table) === normalized) {
      return {
        kind: "table",
        table
      };
    }
  }

  for (const reducer of context.reducers) {
    if (buildReducerRefId(reducer) === normalized) {
      return {
        kind: "reducer",
        reducer
      };
    }
  }

  return null;
}
