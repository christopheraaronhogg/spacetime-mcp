import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import type { SpacetimeDocEntry, SpacetimeDocSearchHit, SpacetimeDocSource } from "../types.js";

const WORKSPACE_DOC_DIRECTORIES = ["docs", ".ai/guidelines", ".spacetime/guidelines", ".ai/skills"];
const WORKSPACE_DOC_FILES = ["README.md", "AGENTS.md", "CLAUDE.md"];
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "target"]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with"
]);

const BUILTIN_SPACETIME_DOCS: SpacetimeDocEntry[] = [
  {
    id: "spacetimedb/core-paradigm",
    title: "SpacetimeDB Core Paradigm",
    source: "builtin",
    tags: ["spacetimedb", "paradigm", "reducers", "tables", "architecture"],
    url: "https://spacetimedb.com/docs",
    content:
      "SpacetimeDB apps expose backend behavior through reducers. Persistent state lives in tables, and clients call generated reducer bindings over realtime connections. Avoid introducing REST layers when reducers already model domain actions."
  },
  {
    id: "spacetimedb/rust-tables",
    title: "Rust Tables and Constraints",
    source: "builtin",
    tags: ["rust", "tables", "schema", "primary_key", "unique", "index"],
    url: "https://spacetimedb.com/docs",
    content:
      "Define tables with #[spacetimedb(table)] structs. Annotate fields with constraints like #[primary_key], #[unique], and #[index] to preserve data integrity and query performance."
  },
  {
    id: "spacetimedb/rust-reducers",
    title: "Reducer Definitions and Signatures",
    source: "builtin",
    tags: ["rust", "reducers", "signatures", "ReducerContext"],
    url: "https://spacetimedb.com/docs",
    content:
      "Reducers are declared with #[spacetimedb(reducer)] and accept typed arguments plus a ReducerContext parameter. Clients must call reducer bindings with the same argument order and type shapes."
  },
  {
    id: "spacetimedb/client-bindings",
    title: "Generated Client Bindings",
    source: "builtin",
    tags: ["client", "typescript", "csharp", "unity", "bindings"],
    url: "https://spacetimedb.com/docs",
    content:
      "Invoke reducers through generated SDK clients, for example client.reducers.tradeItem(...) in TypeScript or connection.Reducers.TradeItem(...) in C#. Avoid manual HTTP wrappers."
  },
  {
    id: "spacetimedb/schema-evolution",
    title: "Schema Evolution and Safety",
    source: "builtin",
    tags: ["schema", "migration", "evolution", "safety"],
    url: "https://spacetimedb.com/docs",
    content:
      "When evolving schema, prefer additive changes and preserve reducer compatibility. Validate existing reducer call sites before renaming fields or changing argument contracts."
  },
  {
    id: "spacetimedb/ai-workflow",
    title: "AI-Assisted SpacetimeDB Workflow",
    source: "builtin",
    tags: ["ai", "workflow", "grounding", "mcp"],
    url: "https://spacetimedb.com/docs",
    content:
      "Before generating code, fetch schema and reducer metadata, ground the assistant with SpacetimeDB rules, then produce reducer and client updates that align with current module state."
  }
];

const DEFAULT_REMOTE_TIMEOUT_MS = 2500;
const DOCS_API_ENV_KEY = "SPACETIME_MCP_DOCS_API_URL";

interface SearchIndexOptions {
  limit?: number;
  source?: "all" | SpacetimeDocSource;
}

export interface SearchSpacetimeDocsOptions extends SearchIndexOptions {
  includeWorkspaceDocs?: boolean;
  includeRemoteDocs?: boolean;
  remoteEndpoint?: string;
  remoteTimeoutMs?: number;
}

export interface SearchSpacetimeDocsResult {
  documentsIndexed: number;
  hits: SpacetimeDocSearchHit[];
  warnings: string[];
  remote: {
    attempted: boolean;
    endpoint?: string;
    hitCount: number;
    durationMs?: number;
    error?: string;
  };
}

interface RemoteSearchResult {
  hits: SpacetimeDocSearchHit[];
  durationMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function coerceExcerpt(hit: Record<string, unknown>): string {
  const fromExcerpt = asString(hit.excerpt);
  if (fromExcerpt) {
    return truncate(fromExcerpt.replace(/\s+/g, " "), 240);
  }

  const fromContent = asString(hit.content);
  if (fromContent) {
    return truncate(fromContent.replace(/\s+/g, " "), 240);
  }

  return "Remote documentation hit.";
}

function extractRemoteHits(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.hits)) {
    return payload.hits;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.hits)) {
      return payload.data.hits;
    }

    if (Array.isArray(payload.data.results)) {
      return payload.data.results;
    }
  }

  return [];
}

async function fetchRemoteDocs(
  query: string,
  endpoint: string,
  limit: number,
  timeoutMs: number
): Promise<RemoteSearchResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, limit }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const rawHits = extractRemoteHits(payload);

    const hits = rawHits
      .map((entry, index): SpacetimeDocSearchHit | null => {
        if (!isRecord(entry)) {
          return null;
        }

        const title = asString(entry.title) ?? asString(entry.name) ?? `Remote Doc #${index + 1}`;
        const url = asString(entry.url);
        const pathValue = asString(entry.path);
        const tags = asStringArray(entry.tags);
        const score = asNumber(entry.score) ?? Math.max(1, 200 - index);

        return {
          id: asString(entry.id) ?? `remote/${index + 1}`,
          title,
          source: "remote",
          score,
          excerpt: coerceExcerpt(entry),
          tags,
          url,
          path: pathValue
        };
      })
      .filter((entry): entry is SpacetimeDocSearchHit => Boolean(entry));

    return {
      hits,
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizePath(workspaceRoot: string, targetPath: string): string {
  return path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
}

async function existsFile(targetPath: string): Promise<boolean> {
  try {
    const metadata = await stat(targetPath);
    return metadata.isFile();
  } catch {
    return false;
  }
}

async function existsDirectory(targetPath: string): Promise<boolean> {
  try {
    const metadata = await stat(targetPath);
    return metadata.isDirectory();
  } catch {
    return false;
  }
}

function inferTitle(relativePath: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]) {
    return heading[1].trim();
  }

  const fallback = path.basename(relativePath).replace(/\.(md|markdown)$/i, "");
  return fallback.replace(/[-_]/g, " ");
}

function inferTags(relativePath: string, content: string): string[] {
  const fromPath = normalizeTokens(relativePath.replace(/[/.]/g, " "));
  const headingTokens = normalizeTokens(content.split("\n").slice(0, 3).join(" "));

  return [...new Set([...fromPath, ...headingTokens])].slice(0, 12);
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".markdown"))) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeTokens(input: string): string[] {
  const lowered = input.toLowerCase().replace(/[^a-z0-9_]+/g, " ");

  return [...new Set(lowered.split(/\s+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

function computeScore(document: SpacetimeDocEntry, rawQuery: string, queryTokens: string[]): number {
  const normalizedQuery = rawQuery.toLowerCase();
  const title = document.title.toLowerCase();
  const content = document.content.toLowerCase();
  const tags = document.tags.map((tag) => tag.toLowerCase());
  const pathValue = (document.path ?? "").toLowerCase();
  const urlValue = (document.url ?? "").toLowerCase();

  let score = 0;

  if (title.includes(normalizedQuery)) {
    score += 120;
  }

  if (content.includes(normalizedQuery)) {
    score += 60;
  }

  if (pathValue.includes(normalizedQuery)) {
    score += 45;
  }

  if (urlValue.includes(normalizedQuery)) {
    score += 30;
  }

  let matchedTokens = 0;

  for (const token of queryTokens) {
    let tokenScore = 0;

    if (title.includes(token)) {
      tokenScore = Math.max(tokenScore, 35);
    }

    if (tags.some((tag) => tag.includes(token))) {
      tokenScore = Math.max(tokenScore, 30);
    }

    if (pathValue.includes(token)) {
      tokenScore = Math.max(tokenScore, 18);
    }

    if (content.includes(token)) {
      tokenScore = Math.max(tokenScore, 12);
    }

    if (tokenScore > 0) {
      matchedTokens += 1;
      score += tokenScore;
    }
  }

  if (queryTokens.length > 0 && matchedTokens === queryTokens.length) {
    score += 30;
  } else if (matchedTokens > 0) {
    score += 8;
  }

  return score;
}

function makeExcerpt(content: string, rawQuery: string, queryTokens: string[]): string {
  const normalizedContent = content.replace(/\s+/g, " ").trim();

  if (normalizedContent.length <= 220) {
    return normalizedContent;
  }

  const lowered = normalizedContent.toLowerCase();
  let matchIndex = lowered.indexOf(rawQuery.toLowerCase());

  if (matchIndex === -1) {
    for (const token of queryTokens) {
      matchIndex = lowered.indexOf(token);
      if (matchIndex !== -1) {
        break;
      }
    }
  }

  if (matchIndex === -1) {
    return `${normalizedContent.slice(0, 220)}...`;
  }

  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(normalizedContent.length, start + 220);

  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedContent.length ? "..." : "";

  return `${prefix}${normalizedContent.slice(start, end).trim()}${suffix}`;
}

export function getBuiltinSpacetimeDocs(): SpacetimeDocEntry[] {
  return BUILTIN_SPACETIME_DOCS.map((document) => ({
    ...document,
    tags: [...document.tags]
  }));
}

export async function loadWorkspaceDocs(workspaceRoot: string): Promise<SpacetimeDocEntry[]> {
  const discoveredFiles = new Set<string>();

  for (const relativeFile of WORKSPACE_DOC_FILES) {
    const filePath = path.join(workspaceRoot, relativeFile);
    if (await existsFile(filePath)) {
      discoveredFiles.add(filePath);
    }
  }

  for (const relativeDirectory of WORKSPACE_DOC_DIRECTORIES) {
    const directoryPath = path.join(workspaceRoot, relativeDirectory);
    if (!(await existsDirectory(directoryPath))) {
      continue;
    }

    for (const filePath of await collectMarkdownFiles(directoryPath)) {
      discoveredFiles.add(filePath);
    }
  }

  const docs: SpacetimeDocEntry[] = [];

  for (const filePath of [...discoveredFiles].sort()) {
    const relativePath = normalizePath(workspaceRoot, filePath);
    const content = await readFile(filePath, "utf8");

    docs.push({
      id: `workspace/${relativePath}`,
      title: inferTitle(relativePath, content),
      content,
      source: "workspace",
      tags: inferTags(relativePath, content),
      path: relativePath
    });
  }

  return docs;
}

export function searchDocsIndex(
  documents: SpacetimeDocEntry[],
  query: string,
  options?: SearchIndexOptions
): SpacetimeDocSearchHit[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const queryTokens = normalizeTokens(normalizedQuery);
  const sourceFilter = options?.source ?? "all";
  const limit = Math.max(1, Math.min(options?.limit ?? 8, 50));

  const hits: SpacetimeDocSearchHit[] = [];

  for (const document of documents) {
    if (sourceFilter !== "all" && document.source !== sourceFilter) {
      continue;
    }

    const score = computeScore(document, normalizedQuery, queryTokens);

    if (score <= 0) {
      continue;
    }

    hits.push({
      id: document.id,
      title: document.title,
      source: document.source,
      score,
      excerpt: makeExcerpt(document.content, normalizedQuery, queryTokens),
      tags: document.tags,
      path: document.path,
      url: document.url
    });
  }

  return hits
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

export async function searchSpacetimeDocs(
  workspaceRoot: string,
  query: string,
  options?: SearchSpacetimeDocsOptions
): Promise<SearchSpacetimeDocsResult> {
  const source = options?.source ?? "all";
  const limit = Math.max(1, Math.min(options?.limit ?? 8, 50));
  const includeWorkspaceDocs = options?.includeWorkspaceDocs ?? true;
  const includeRemoteDocs = options?.includeRemoteDocs ?? source === "remote";
  const remoteEndpoint = options?.remoteEndpoint ?? process.env[DOCS_API_ENV_KEY];
  const remoteTimeoutMs = Math.max(500, Math.min(options?.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS, 10000));
  const warnings: string[] = [];

  const documents: SpacetimeDocEntry[] = [...getBuiltinSpacetimeDocs()];
  if (includeWorkspaceDocs) {
    documents.push(...(await loadWorkspaceDocs(workspaceRoot)));
  }

  const localHits =
    source === "remote"
      ? []
      : searchDocsIndex(documents, query, {
          limit,
          source
        });

  let remoteHits: SpacetimeDocSearchHit[] = [];
  const remote = {
    attempted: false,
    endpoint: remoteEndpoint,
    hitCount: 0,
    durationMs: undefined as number | undefined,
    error: undefined as string | undefined
  };

  if (includeRemoteDocs || source === "remote") {
    remote.attempted = true;

    if (!remoteEndpoint) {
      const warning =
        `Remote docs search requested, but ${DOCS_API_ENV_KEY} is not configured and no remoteEndpoint was provided.`;
      warnings.push(warning);
      remote.error = warning;
    } else {
      try {
        const result = await fetchRemoteDocs(query, remoteEndpoint, limit, remoteTimeoutMs);
        remoteHits = result.hits;
        remote.hitCount = remoteHits.length;
        remote.durationMs = result.durationMs;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const warning = `Remote docs search failed: ${message}`;
        warnings.push(warning);
        remote.error = warning;
      }
    }
  }

  const hits =
    source === "remote"
      ? remoteHits
      : source === "all"
        ? [...localHits, ...remoteHits]
            .sort((left, right) => {
              if (right.score !== left.score) {
                return right.score - left.score;
              }

              return left.title.localeCompare(right.title);
            })
            .slice(0, limit)
        : localHits;

  if (source === "remote" && remote.attempted && remoteHits.length === 0 && !remote.error) {
    warnings.push("Remote docs search returned no results.");
  }

  if (source !== "remote" && includeRemoteDocs && remote.attempted && remoteHits.length === 0 && !remote.error) {
    warnings.push("Remote docs search returned no matches; using local documentation index only.");
  }

  return {
    documentsIndexed: documents.length,
    hits,
    warnings,
    remote
  };
}
