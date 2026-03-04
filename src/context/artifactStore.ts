import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import type { SpacetimeArtifactRecord, SpacetimeDataResolution } from "../types.js";

const ARTIFACT_ROOT = ".spacetime-mcp/artifacts";
const INDEX_FILENAME = "index.json";
const DEFAULT_ARTIFACT_TTL_MS = 1000 * 60 * 60 * 24 * 3;

interface ArtifactIndexRecord extends SpacetimeArtifactRecord {
  absolutePath: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const metadata = await stat(targetPath);
    return metadata.isFile();
  } catch {
    return false;
  }
}

export interface SaveArtifactParams {
  toolName: string;
  resolution: SpacetimeDataResolution;
  payload: unknown;
}

export interface ReadArtifactChunkResult {
  artifact: SpacetimeArtifactRecord;
  chunk: string;
  offset: number;
  limit: number;
  nextOffset: number | null;
  done: boolean;
  totalChars: number;
}

export class WorkspaceArtifactStore {
  private readonly artifactRoot: string;
  private readonly indexPath: string;

  public constructor(
    private readonly workspaceRoot: string,
    private readonly defaultTtlMs = DEFAULT_ARTIFACT_TTL_MS
  ) {
    this.artifactRoot = path.join(workspaceRoot, ARTIFACT_ROOT);
    this.indexPath = path.join(this.artifactRoot, INDEX_FILENAME);
  }

  public async saveArtifact(params: SaveArtifactParams): Promise<SpacetimeArtifactRecord> {
    await this.ensureDirectory();
    await this.cleanup();

    const format = typeof params.payload === "string" ? "text" : "json";
    const serialized =
      format === "text"
        ? String(params.payload)
        : JSON.stringify(params.payload ?? null, null, 2);

    const id = this.createArtifactId();
    const extension = format === "json" ? "json" : "txt";
    const filename = `${id}.${extension}`;
    const absolutePath = path.join(this.artifactRoot, filename);
    const relativePath = path.posix.join(ARTIFACT_ROOT, filename);

    await writeFile(absolutePath, serialized, "utf8");

    const bytes = Buffer.byteLength(serialized, "utf8");
    const createdAt = new Date().toISOString();

    const nextRecord: ArtifactIndexRecord = {
      id,
      toolName: params.toolName,
      resolution: params.resolution,
      createdAt,
      bytes,
      format,
      path: relativePath,
      absolutePath
    };

    const index = await this.loadIndex();
    index.unshift(nextRecord);
    await this.writeIndex(index);

    return this.toPublicRecord(nextRecord);
  }

  public async listArtifacts(options?: {
    limit?: number;
    maxAgeMs?: number;
  }): Promise<SpacetimeArtifactRecord[]> {
    const maxAgeMs = options?.maxAgeMs;
    await this.cleanup(maxAgeMs);

    const index = await this.loadIndex();
    const limit = clamp(options?.limit ?? 20, 1, 200);

    return index.slice(0, limit).map((record) => this.toPublicRecord(record));
  }

  public async readArtifactChunk(
    artifactId: string,
    options?: {
      offset?: number;
      limit?: number;
    }
  ): Promise<ReadArtifactChunkResult | null> {
    await this.ensureDirectory();

    const record = await this.findRecord(artifactId);
    if (!record) {
      return null;
    }

    if (!(await fileExists(record.absolutePath))) {
      return null;
    }

    const content = await readFile(record.absolutePath, "utf8");
    const offset = clamp(options?.offset ?? 0, 0, content.length);
    const limit = clamp(options?.limit ?? 4000, 200, 20000);

    const chunk = content.slice(offset, offset + limit);
    const nextOffset = offset + chunk.length;

    return {
      artifact: this.toPublicRecord(record),
      chunk,
      offset,
      limit,
      nextOffset: nextOffset >= content.length ? null : nextOffset,
      done: nextOffset >= content.length,
      totalChars: content.length
    };
  }

  public async cleanup(maxAgeMs = this.defaultTtlMs): Promise<void> {
    await this.ensureDirectory();

    const index = await this.loadIndex();
    const now = Date.now();
    const retained: ArtifactIndexRecord[] = [];

    for (const record of index) {
      const createdAtMs = Date.parse(record.createdAt);
      const ageMs = Number.isFinite(createdAtMs) ? now - createdAtMs : Number.POSITIVE_INFINITY;
      const expired = ageMs > maxAgeMs;

      const exists = await fileExists(record.absolutePath);

      if (expired || !exists) {
        if (exists) {
          await rm(record.absolutePath, { force: true });
        }
        continue;
      }

      retained.push(record);
    }

    await this.writeIndex(retained);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.artifactRoot, { recursive: true });
  }

  private createArtifactId(): string {
    return `${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  }

  private async findRecord(artifactId: string): Promise<ArtifactIndexRecord | null> {
    const normalized = artifactId.trim();
    if (normalized.length === 0) {
      return null;
    }

    const index = await this.loadIndex();
    return index.find((record) => record.id === normalized) ?? null;
  }

  private async loadIndex(): Promise<ArtifactIndexRecord[]> {
    await this.ensureDirectory();

    if (!(await fileExists(this.indexPath))) {
      return [];
    }

    const raw = await readFile(this.indexPath, "utf8");
    const parsed = parseJson<SpacetimeArtifactRecord[]>(raw, []);

    return parsed
      .map((record): ArtifactIndexRecord | null => {
        if (
          !record ||
          typeof record.id !== "string" ||
          typeof record.path !== "string" ||
          typeof record.toolName !== "string" ||
          typeof record.createdAt !== "string" ||
          typeof record.bytes !== "number"
        ) {
          return null;
        }

        const absolutePath = path.join(this.workspaceRoot, record.path);

        return {
          ...record,
          absolutePath
        };
      })
      .filter((entry): entry is ArtifactIndexRecord => Boolean(entry));
  }

  private async writeIndex(index: ArtifactIndexRecord[]): Promise<void> {
    const serializable = index.map((entry) => this.toPublicRecord(entry));
    await writeFile(this.indexPath, JSON.stringify(serializable, null, 2), "utf8");
  }

  private toPublicRecord(record: ArtifactIndexRecord): SpacetimeArtifactRecord {
    return {
      id: record.id,
      toolName: record.toolName,
      resolution: record.resolution,
      createdAt: record.createdAt,
      bytes: record.bytes,
      format: record.format,
      path: record.path
    };
  }
}
