import { createHash } from "node:crypto";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import type { SpacetimeWorkspaceContext } from "../types.js";
import { parseRustModule } from "./rustParser.js";

const PRIMARY_SCAN_DIRECTORIES = ["server", "module", "src"];
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target"
]);

export interface WorkspaceDiscovery {
  scanRoots: string[];
  rustFiles: string[];
}

function normalizeRelativePath(workspaceRoot: string, targetPath: string): string {
  const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");
  return relativePath.length > 0 ? relativePath : ".";
}

async function existsDirectory(targetPath: string): Promise<boolean> {
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function collectRustFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

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

export async function discoverWorkspace(workspaceRoot: string): Promise<WorkspaceDiscovery> {
  const scanRoots: string[] = [];

  for (const candidate of PRIMARY_SCAN_DIRECTORIES) {
    const candidatePath = path.join(workspaceRoot, candidate);
    if (await existsDirectory(candidatePath)) {
      scanRoots.push(candidatePath);
    }
  }

  if (scanRoots.length === 0) {
    scanRoots.push(workspaceRoot);
  }

  const rustFiles: string[] = [];
  for (const root of scanRoots) {
    const discovered = await collectRustFilesRecursive(root);
    rustFiles.push(...discovered);
  }

  return {
    scanRoots,
    rustFiles: [...new Set(rustFiles)]
  };
}

export async function calculateWorkspaceFingerprint(discovery: WorkspaceDiscovery): Promise<string> {
  const hash = createHash("sha1");

  const sortedRoots = [...discovery.scanRoots].sort();
  const sortedFiles = [...discovery.rustFiles].sort();

  hash.update(sortedRoots.join("|"));

  for (const filePath of sortedFiles) {
    const metadata = await stat(filePath);
    hash.update(`${filePath}|${metadata.size}|${metadata.mtimeMs}`);
  }

  return hash.digest("hex");
}

function normalizeModulePath(workspaceRoot: string, filePath: string): string {
  return normalizeRelativePath(workspaceRoot, filePath);
}

export async function scanWorkspace(
  workspaceRoot: string,
  discovery?: WorkspaceDiscovery
): Promise<SpacetimeWorkspaceContext> {
  const currentDiscovery = discovery ?? (await discoverWorkspace(workspaceRoot));

  const parsedModules = await Promise.all(
    currentDiscovery.rustFiles.map(async (filePath) => {
      const source = await readFile(filePath, "utf8");
      const modulePath = normalizeModulePath(workspaceRoot, filePath);
      return parseRustModule(source, modulePath);
    })
  );

  const context: SpacetimeWorkspaceContext = {
    tables: [],
    reducers: [],
    metadata: {
      detectedLanguages: currentDiscovery.rustFiles.length > 0 ? ["rust"] : [],
      filesScanned: currentDiscovery.rustFiles
        .map((filePath) => normalizeRelativePath(workspaceRoot, filePath))
        .sort(),
      directoriesScanned: currentDiscovery.scanRoots
        .map((scanRoot) => normalizeRelativePath(workspaceRoot, scanRoot))
        .sort(),
      generatedAt: new Date().toISOString()
    }
  };

  for (const parsed of parsedModules) {
    context.tables.push(...parsed.tables);
    context.reducers.push(...parsed.reducers);
  }

  return context;
}
