export interface TableColumn {
  name: string;
  type: string;
  constraints: string[];
}

export interface TableSchema {
  name: string;
  module: string;
  columns: TableColumn[];
}

export interface ReducerArgument {
  name: string;
  type: string;
}

export interface ReducerSchema {
  name: string;
  module: string;
  arguments: ReducerArgument[];
}

export type SpacetimeLanguage = "rust";

export interface SpacetimeScanMetadata {
  detectedLanguages: SpacetimeLanguage[];
  filesScanned: string[];
  directoriesScanned: string[];
  generatedAt: string;
}

export interface SpacetimeWorkspaceContext {
  tables: TableSchema[];
  reducers: ReducerSchema[];
  metadata: SpacetimeScanMetadata;
}

export type SpacetimeSymbolType = "table" | "reducer";

export interface SpacetimeSymbolMatch {
  kind: SpacetimeSymbolType;
  name: string;
  module: string;
  signature?: string;
  score: number;
}

export interface SpacetimeGuideline {
  id: string;
  title: string;
  content: string;
  source: "builtin" | "workspace";
  path?: string;
}

export interface SpacetimeSkill {
  name: string;
  description?: string;
  content: string;
  path: string;
}

export type ClientTarget = "typescript" | "csharp" | "unity";

export interface ReducerClientUsage {
  reducerName: string;
  module: string;
  client: ClientTarget;
  arguments: ReducerArgument[];
  invocation: string;
  alternatives: string[];
  notes: string[];
}

export type SpacetimeDocSource = "builtin" | "workspace";

export interface SpacetimeDocEntry {
  id: string;
  title: string;
  content: string;
  source: SpacetimeDocSource;
  tags: string[];
  path?: string;
  url?: string;
}

export interface SpacetimeDocSearchHit {
  id: string;
  title: string;
  source: SpacetimeDocSource;
  score: number;
  excerpt: string;
  tags: string[];
  path?: string;
  url?: string;
}
