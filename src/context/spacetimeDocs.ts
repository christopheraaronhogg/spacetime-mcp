export const SPACETIME_PARADIGM_RULES = [
  "SpacetimeDB reducers are the backend API. Prefer reducers over HTTP endpoints.",
  "Model persistent state with SpacetimeDB tables, not external ORM migrations.",
  "When adding features, extend existing reducers and tables before introducing new patterns.",
  "Client-side actions should call generated SpacetimeDB SDK reducer bindings.",
  "Validate argument names and types against current reducer signatures before generating code."
];

export function getSpacetimeDocsMarkdown(): string {
  const bullets = SPACETIME_PARADIGM_RULES.map((rule) => `- ${rule}`).join("\n");
  return `# SpacetimeDB Grounding Rules\n\n${bullets}`;
}
