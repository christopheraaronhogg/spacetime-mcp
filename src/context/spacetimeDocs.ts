import type { SpacetimeGuideline, SpacetimeSkill } from "../types.js";

export const SPACETIME_PARADIGM_RULES = [
  "Treat reducers as the backend API surface. Do not introduce HTTP routes for reducer-backed flows.",
  "Model persistent state with SpacetimeDB tables and reducer logic, not external ORM migrations.",
  "Before adding new reducers, inspect existing reducer signatures to preserve conventions and naming.",
  "Client-side actions should call generated SpacetimeDB SDK reducer bindings with correct argument order.",
  "Use table constraints (primary key, unique, index) to preserve invariants and query performance."
];

export const SPACETIME_ANTI_PATTERNS = [
  "Do not generate REST controllers, CRUD routers, or SQL migration files for SpacetimeDB modules.",
  "Do not duplicate table concepts in parallel in-memory stores unless clearly scoped to UI state.",
  "Do not rename reducers without updating all generated client invocations and call sites.",
  "Do not infer reducer arguments from memory; always read the live workspace schema first."
];

export const SPACETIME_WORKFLOW_CHECKLIST = [
  "Read relevant table schema before proposing reducer updates.",
  "Validate reducer argument names and types against current module definitions.",
  "Return client invocation examples for TypeScript or Unity/C# when adding reducers.",
  "Prefer small schema-safe updates over broad refactors unless requested explicitly."
];

const BUILTIN_GUIDELINES: SpacetimeGuideline[] = [
  {
    id: "core/spacetimedb-paradigm",
    title: "SpacetimeDB Core Paradigm",
    source: "builtin",
    content: SPACETIME_PARADIGM_RULES.map((rule) => `- ${rule}`).join("\n")
  },
  {
    id: "core/anti-patterns",
    title: "SpacetimeDB Anti-Patterns",
    source: "builtin",
    content: SPACETIME_ANTI_PATTERNS.map((rule) => `- ${rule}`).join("\n")
  },
  {
    id: "core/reducer-workflow",
    title: "Reducer Change Workflow",
    source: "builtin",
    content: SPACETIME_WORKFLOW_CHECKLIST.map((rule) => `- ${rule}`).join("\n")
  }
];

export function getBuiltinGuidelines(): SpacetimeGuideline[] {
  return BUILTIN_GUIDELINES;
}

interface DocsMarkdownOptions {
  additionalGuidelines?: SpacetimeGuideline[];
  skills?: SpacetimeSkill[];
}

export function getSpacetimeDocsMarkdown(options?: DocsMarkdownOptions): string {
  const guidelines = [...BUILTIN_GUIDELINES, ...(options?.additionalGuidelines ?? [])];
  const guidelineBlocks = guidelines
    .map((guideline) => {
      const source = guideline.source === "workspace" ? ` (workspace: ${guideline.path})` : "";
      return `## ${guideline.title}${source}\n\n${guideline.content.trim()}`;
    })
    .join("\n\n");

  const skillSection =
    options?.skills && options.skills.length > 0
      ? `\n\n## Available Skills\n\n${options.skills
          .map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ""}`)
          .join("\n")}`
      : "";

  return `# SpacetimeDB Grounding Rules\n\n${guidelineBlocks}${skillSection}`;
}
