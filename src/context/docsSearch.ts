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

interface SearchIndexOptions {
  limit?: number;
  source?: "all" | SpacetimeDocSource;
}

export interface SearchSpacetimeDocsOptions extends SearchIndexOptions {
  includeWorkspaceDocs?: boolean;
}

export interface SearchSpacetimeDocsResult {
  documentsIndexed: number;
  hits: SpacetimeDocSearchHit[];
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
  const includeWorkspaceDocs = options?.includeWorkspaceDocs ?? true;

  const documents: SpacetimeDocEntry[] = [...getBuiltinSpacetimeDocs()];
  if (includeWorkspaceDocs) {
    documents.push(...(await loadWorkspaceDocs(workspaceRoot)));
  }

  const hits = searchDocsIndex(documents, query, {
    limit: options?.limit,
    source: options?.source
  });

  return {
    documentsIndexed: documents.length,
    hits
  };
}
