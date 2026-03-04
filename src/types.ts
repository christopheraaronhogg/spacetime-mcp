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

export interface SpacetimeWorkspaceContext {
  tables: TableSchema[];
  reducers: ReducerSchema[];
}
