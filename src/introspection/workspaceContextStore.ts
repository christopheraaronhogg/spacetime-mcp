import type { SpacetimeWorkspaceContext } from "../types.js";
import {
  calculateWorkspaceFingerprint,
  discoverWorkspace,
  scanWorkspace
} from "./workspaceScanner.js";

interface CachedContext {
  fingerprint: string;
  context: SpacetimeWorkspaceContext;
}

export interface ContextStoreResult {
  context: SpacetimeWorkspaceContext;
  cacheHit: boolean;
  fingerprint: string;
}

export class WorkspaceContextStore {
  private cached: CachedContext | null = null;

  public constructor(private readonly workspaceRoot: string) {}

  public async getContext(options?: { forceRefresh?: boolean }): Promise<ContextStoreResult> {
    const discovery = await discoverWorkspace(this.workspaceRoot);
    const fingerprint = await calculateWorkspaceFingerprint(discovery);

    if (!options?.forceRefresh && this.cached && this.cached.fingerprint === fingerprint) {
      return {
        context: this.cached.context,
        cacheHit: true,
        fingerprint
      };
    }

    const context = await scanWorkspace(this.workspaceRoot, discovery);

    this.cached = {
      fingerprint,
      context
    };

    return {
      context,
      cacheHit: false,
      fingerprint
    };
  }
}
