import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import type { SpacetimeGuideline, SpacetimeSkill } from "../types.js";

const GUIDELINE_DIRECTORIES = [".ai/guidelines", ".spacetime/guidelines"];
const SKILLS_DIRECTORY = ".ai/skills";

async function existsDirectory(targetPath: string): Promise<boolean> {
  try {
    const metadata = await stat(targetPath);
    return metadata.isDirectory();
  } catch {
    return false;
  }
}

function toRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".markdown"))) {
      files.push(fullPath);
    }
  }

  return files;
}

function inferTitleFromContent(fallbackName: string, content: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim();
  }

  return fallbackName;
}

export async function loadWorkspaceGuidelines(workspaceRoot: string): Promise<SpacetimeGuideline[]> {
  const guidelines: SpacetimeGuideline[] = [];

  for (const relativeDir of GUIDELINE_DIRECTORIES) {
    const absoluteDir = path.join(workspaceRoot, relativeDir);
    if (!(await existsDirectory(absoluteDir))) {
      continue;
    }

    const files = await collectMarkdownFiles(absoluteDir);

    for (const filePath of files) {
      const content = await readFile(filePath, "utf8");
      const relativePath = toRelativePath(workspaceRoot, filePath);
      const fallbackTitle = path.basename(filePath).replace(/\.(md|markdown)$/i, "");

      guidelines.push({
        id: relativePath.replace(/\.(md|markdown)$/i, ""),
        title: inferTitleFromContent(fallbackTitle, content),
        content,
        source: "workspace",
        path: relativePath
      });
    }
  }

  return guidelines.sort((left, right) => left.id.localeCompare(right.id));
}

interface ParsedFrontmatter {
  body: string;
  values: Record<string, string>;
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith("---\n")) {
    return {
      body: markdown,
      values: {}
    };
  }

  const closingIndex = markdown.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return {
      body: markdown,
      values: {}
    };
  }

  const rawFrontmatter = markdown.slice(4, closingIndex);
  const body = markdown.slice(closingIndex + 5);
  const values: Record<string, string> = {};

  for (const line of rawFrontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key.length > 0 && value.length > 0) {
      values[key] = value;
    }
  }

  return {
    body,
    values
  };
}

export async function listWorkspaceSkills(workspaceRoot: string): Promise<SpacetimeSkill[]> {
  const skillsRoot = path.join(workspaceRoot, SKILLS_DIRECTORY);
  if (!(await existsDirectory(skillsRoot))) {
    return [];
  }

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills: SpacetimeSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDirectory = path.join(skillsRoot, entry.name);
    const skillFilePath = path.join(skillDirectory, "SKILL.md");

    try {
      const content = await readFile(skillFilePath, "utf8");
      const parsed = parseFrontmatter(content);

      skills.push({
        name: parsed.values.name ?? entry.name,
        description: parsed.values.description,
        content: parsed.body.trim(),
        path: toRelativePath(workspaceRoot, skillFilePath)
      });
    } catch {
      continue;
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export async function findWorkspaceSkill(
  workspaceRoot: string,
  skillName: string
): Promise<SpacetimeSkill | undefined> {
  const skills = await listWorkspaceSkills(workspaceRoot);
  const normalized = skillName.trim().toLowerCase();

  return skills.find((skill) => skill.name.toLowerCase() === normalized);
}
