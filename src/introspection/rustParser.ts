import type { ReducerArgument, ReducerSchema, TableColumn, TableSchema } from "../types.js";

const TABLE_REGEX =
  /#\s*\[spacetimedb\(table(?:\([^\)]*\))?\)\](?:\s*#\[[^\]]+\])*\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}/g;
const FIELD_REGEX =
  /((?:\s*#\[[^\]]+\]\s*)*)(?:pub(?:\([^\)]*\))?\s+)?([A-Za-z0-9_]+)\s*:\s*([^,\n]+),/g;
const REDUCER_REGEX =
  /#\s*\[spacetimedb\(reducer(?:\([^\)]*\))?\)\](?:\s*#\[[^\]]+\])*\s*(?:pub\s+)?fn\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:->[\s\S]*?)?\s*\{/g;

function extractConstraints(attributeBlock: string): string[] {
  const constraints: string[] = [];

  if (attributeBlock.includes("#[unique]")) {
    constraints.push("unique");
  }

  if (attributeBlock.includes("#[primary_key]")) {
    constraints.push("primary_key");
  }

  if (attributeBlock.includes("#[index]")) {
    constraints.push("index");
  }

  return constraints;
}

function splitTopLevelArgs(argumentBlock: string): string[] {
  const parts: string[] = [];
  let current = "";
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (const char of argumentBlock) {
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    }

    if (char === "," && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last.length > 0) {
    parts.push(last);
  }

  return parts;
}

function parseReducerArguments(argumentBlock: string): ReducerArgument[] {
  const rawArgs = splitTopLevelArgs(argumentBlock);

  return rawArgs
    .map((arg) => {
      const separatorIndex = arg.indexOf(":");
      if (separatorIndex === -1) {
        return null;
      }

      const name = arg.slice(0, separatorIndex).trim().replace(/^mut\s+/, "");
      const type = arg.slice(separatorIndex + 1).trim();

      if (name.length === 0 || type.length === 0) {
        return null;
      }

      return { name, type };
    })
    .filter((entry): entry is ReducerArgument => {
      if (!entry) {
        return false;
      }

      if (entry.type.includes("ReducerContext")) {
        return false;
      }

      return true;
    });
}

function parseTableColumns(tableBody: string): TableColumn[] {
  const columns: TableColumn[] = [];

  for (const fieldMatch of tableBody.matchAll(FIELD_REGEX)) {
    const [, attrs, fieldName, fieldType] = fieldMatch;
    columns.push({
      name: fieldName,
      type: fieldType.trim(),
      constraints: extractConstraints(attrs ?? "")
    });
  }

  return columns;
}

export function parseRustModule(source: string, modulePath: string): {
  tables: TableSchema[];
  reducers: ReducerSchema[];
} {
  const tables: TableSchema[] = [];
  const reducers: ReducerSchema[] = [];

  for (const tableMatch of source.matchAll(TABLE_REGEX)) {
    const [, tableName, tableBody] = tableMatch;
    tables.push({
      name: tableName,
      module: modulePath,
      columns: parseTableColumns(tableBody)
    });
  }

  for (const reducerMatch of source.matchAll(REDUCER_REGEX)) {
    const [, reducerName, argsBlock] = reducerMatch;
    reducers.push({
      name: reducerName,
      module: modulePath,
      arguments: parseReducerArguments(argsBlock)
    });
  }

  return { tables, reducers };
}
