import type {
  ReducerSchema,
  SpacetimeSymbolMatch,
  SpacetimeSymbolType,
  SpacetimeWorkspaceContext,
  TableSchema
} from "../types.js";

export function formatReducerSignature(reducer: ReducerSchema): string {
  const args = reducer.arguments.map((arg) => `${arg.name}: ${arg.type}`).join(", ");
  return `${reducer.name}(${args})`;
}

export function findTableByName(
  context: SpacetimeWorkspaceContext,
  tableName: string
): TableSchema | undefined {
  const expected = tableName.trim().toLowerCase();
  return context.tables.find((table) => table.name.toLowerCase() === expected);
}

export function findReducerByName(
  context: SpacetimeWorkspaceContext,
  reducerName: string
): ReducerSchema | undefined {
  const expected = reducerName.trim().toLowerCase();
  return context.reducers.find((reducer) => reducer.name.toLowerCase() === expected);
}

function scoreSymbol(name: string, modulePath: string, query: string): number {
  const normalizedName = name.toLowerCase();
  const normalizedModule = modulePath.toLowerCase();

  if (normalizedName === query) {
    return 100;
  }

  if (normalizedName.startsWith(query)) {
    return 80;
  }

  if (normalizedName.includes(query)) {
    return 60;
  }

  if (normalizedModule.includes(query)) {
    return 35;
  }

  return 0;
}

export function searchSymbols(
  context: SpacetimeWorkspaceContext,
  query: string,
  kind: SpacetimeSymbolType | "all" = "all",
  limit = 20
): SpacetimeSymbolMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: SpacetimeSymbolMatch[] = [];

  if (kind === "all" || kind === "table") {
    for (const table of context.tables) {
      const score = scoreSymbol(table.name, table.module, normalizedQuery);
      if (score > 0) {
        matches.push({
          kind: "table",
          name: table.name,
          module: table.module,
          signature: `${table.name} { ${table.columns.map((column) => column.name).join(", ")} }`,
          score
        });
      }
    }
  }

  if (kind === "all" || kind === "reducer") {
    for (const reducer of context.reducers) {
      const score = scoreSymbol(reducer.name, reducer.module, normalizedQuery);
      if (score > 0) {
        matches.push({
          kind: "reducer",
          name: reducer.name,
          module: reducer.module,
          signature: formatReducerSignature(reducer),
          score
        });
      }
    }
  }

  return matches
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
