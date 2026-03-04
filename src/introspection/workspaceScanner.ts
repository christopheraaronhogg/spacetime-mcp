import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import { parseRustModule } from "./rustParser.js";
import type { SpacetimeWorkspaceContext } from "../types.js";

const PRIMARY_SCAN_DIRECTORIES = ["server", "module", "src"];

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectRustFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const nested = await collectRustFilesRecursive(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function discoverRustFiles(workspaceRoot: string): Promise<string[]> {
  const scanRoots: string[] = [];

  for (const candidate of PRIMARY_SCAN_DIRECTORIES) {
    const candidatePath = path.join(workspaceRoot, candidate);
    if (await exists(candidatePath)) {
      scanRoots.push(candidatePath);
    }
  }

  if (scanRoots.length === 0) {
    scanRoots.push(workspaceRoot);
  }

  const files: string[] = [];
  for (const root of scanRoots) {
    const discovered = await collectRustFilesRecursive(root);
    files.push(...discovered);
  }

  return [...new Set(files)];
}

function normalizeModulePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
}

export async function scanWorkspace(workspaceRoot: string): Promise<SpacetimeWorkspaceContext> {
  const rustFiles = await discoverRustFiles(workspaceRoot);
  const context: SpacetimeWorkspaceContext = {
    tables: [],
    reducers: []
  };

  for (const filePath of rustFiles) {
    const source = await readFile(filePath, "utf8");
    const modulePath = normalizeModulePath(workspaceRoot, filePath);
    const parsed = parseRustModule(source, modulePath);
    context.tables.push(...parsed.tables);
    context.reducers.push(...parsed.reducers);
  }

  return context;
}
