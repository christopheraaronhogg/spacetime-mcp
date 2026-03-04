import { isDeepStrictEqual } from "node:util";

export type TomlPrimitive = string | number | boolean;
export type TomlValue = TomlPrimitive | TomlPrimitive[];

export interface JsonServerMergeOptions {
  existingContent?: string;
  serverCollectionKey: string;
  serverName: string;
  serverConfig: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
}

export interface ConfigMergeResult {
  content?: string;
  changed: boolean;
  created: boolean;
  error?: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toJsonContent(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function mergeJsonServerConfig(options: JsonServerMergeOptions): ConfigMergeResult {
  const existing = options.existingContent;

  if (existing === undefined) {
    const root = cloneObject(options.defaultConfig ?? {});
    root[options.serverCollectionKey] = {
      [options.serverName]: options.serverConfig
    };

    return {
      content: toJsonContent(root),
      changed: true,
      created: true
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(existing);
  } catch {
    return {
      changed: false,
      created: false,
      error: "existing file is not valid JSON"
    };
  }

  if (!isObjectRecord(parsed)) {
    return {
      changed: false,
      created: false,
      error: "existing JSON root must be an object"
    };
  }

  const root = cloneObject(parsed);
  const currentCollection = root[options.serverCollectionKey];

  if (currentCollection !== undefined && !isObjectRecord(currentCollection)) {
    return {
      changed: false,
      created: false,
      error: `key \"${options.serverCollectionKey}\" is not an object`
    };
  }

  const servers = isObjectRecord(currentCollection) ? cloneObject(currentCollection) : {};
  servers[options.serverName] = options.serverConfig;
  root[options.serverCollectionKey] = servers;

  if (isDeepStrictEqual(parsed, root)) {
    return {
      content: existing,
      changed: false,
      created: false
    };
  }

  return {
    content: toJsonContent(root),
    changed: true,
    created: false
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function formatTomlValue(value: TomlValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatTomlValue(entry)).join(", ")}]`;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return `\"${escapeTomlString(value)}\"`;
}

function removeTomlSection(content: string, sectionName: string): string {
  const escaped = escapeRegExp(sectionName);
  const sectionPattern = new RegExp(
    `(?:\\r?\\n)*\\[${escaped}(?:\\.[^\\]]+)?\\][\\s\\S]*?(?=(?:\\r?\\n)\\[[^\\]]+\\]|$)`,
    "g"
  );

  return content.replace(sectionPattern, "");
}

function buildTomlSection(sectionName: string, values: Record<string, TomlValue>): string {
  const lines = [`[${sectionName}]`];

  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }

  return lines.join("\n");
}

export interface TomlSectionMergeOptions {
  existingContent?: string;
  sectionName: string;
  values: Record<string, TomlValue>;
}

export function upsertTomlSection(options: TomlSectionMergeOptions): ConfigMergeResult {
  const desiredSection = buildTomlSection(options.sectionName, options.values);

  if (options.existingContent === undefined) {
    return {
      content: `${desiredSection}\n`,
      changed: true,
      created: true
    };
  }

  const normalizedExisting = options.existingContent.replace(/\r\n/g, "\n");
  const withoutSection = removeTomlSection(normalizedExisting, options.sectionName);
  const trimmed = withoutSection.trimEnd();

  const nextContent = `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${desiredSection}\n`;

  if (nextContent === normalizedExisting) {
    return {
      content: options.existingContent,
      changed: false,
      created: false
    };
  }

  return {
    content: nextContent,
    changed: true,
    created: false
  };
}
