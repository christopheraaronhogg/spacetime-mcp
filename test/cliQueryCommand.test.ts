import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliEntryPath = path.join(repoRoot, "src", "index.ts");

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<CliRunResult> {
  const child = spawn(process.execPath, [tsxCliPath, cliEntryPath, ...args], {
    cwd: repoRoot,
    env: process.env
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI command timed out: ${args.join(" ")}`));
    }, 20000);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });

  return {
    exitCode,
    stdout,
    stderr
  };
}

async function withSpacetimeWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-query-test-"));

  try {
    const serverDir = path.join(workspaceRoot, "server");
    await mkdir(serverDir, { recursive: true });

    await writeFile(
      path.join(serverDir, "module.rs"),
      `#[spacetimedb(table)]
pub struct Player {
  #[primary_key]
  pub id: u64,
  #[index]
  pub name: String,
  pub level: u32,
}

#[spacetimedb(reducer)]
pub fn set_name(ctx: &ReducerContext, id: u64, name: String) {
  let _ = (ctx, id, name);
}
`,
      "utf8"
    );

    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("CLI query schema defaults to minimal inline payload", async () => {
  await withSpacetimeWorkspace(async (workspaceRoot) => {
    const result = await runCli(["query", "schema", "--workspace", workspaceRoot, "--json"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr.trim(), "");

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      result: {
        responseMode: string;
        resolution: string;
        data: {
          tables: Array<Record<string, unknown>>;
        };
      };
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.result.responseMode, "inline");
    assert.equal(payload.result.resolution, "minimal");
    assert.equal(Array.isArray(payload.result.data.tables), true);
    assert.equal(payload.result.data.tables.length > 0, true);

    const firstTable = payload.result.data.tables[0] ?? {};
    assert.equal(typeof firstTable.refId, "string");
    assert.equal(typeof firstTable.columnCount, "number");
    assert.equal("columns" in firstTable, false);
  });
});

test("CLI query supports artifact pointer flow", async () => {
  await withSpacetimeWorkspace(async (workspaceRoot) => {
    const queryResult = await runCli([
      "query",
      "schema",
      "--workspace",
      workspaceRoot,
      "--full",
      "--artifact",
      "--json"
    ]);

    assert.equal(queryResult.exitCode, 0);

    const payload = JSON.parse(queryResult.stdout) as {
      result: {
        responseMode: string;
        artifact: {
          id: string;
        };
      };
    };

    assert.equal(payload.result.responseMode, "artifact");
    const artifactId = payload.result.artifact.id;
    assert.equal(typeof artifactId, "string");

    const readResult = await runCli([
      "query",
      "artifact",
      artifactId,
      "--workspace",
      workspaceRoot,
      "--json"
    ]);

    assert.equal(readResult.exitCode, 0);

    const readPayload = JSON.parse(readResult.stdout) as {
      result: {
        artifact: {
          id: string;
        };
        chunk: string;
      };
    };

    assert.equal(readPayload.result.artifact.id, artifactId);
    assert.match(readPayload.result.chunk, /"columns"/);
  });
});

test("CLI query resolves ref ids returned from symbol search", async () => {
  await withSpacetimeWorkspace(async (workspaceRoot) => {
    const searchResult = await runCli([
      "query",
      "symbols",
      "player",
      "--workspace",
      workspaceRoot,
      "--json"
    ]);

    assert.equal(searchResult.exitCode, 0);

    const searchPayload = JSON.parse(searchResult.stdout) as {
      result: {
        data: {
          matches: Array<{ refId?: string }>;
        };
      };
      hints: string[];
    };

    const refId = searchPayload.result.data.matches.find((match) => Boolean(match.refId))?.refId;
    assert.equal(typeof refId, "string");
    assert.equal(searchPayload.hints.some((hint) => hint.includes("query ref")), true);

    const refResult = await runCli([
      "query",
      "ref",
      String(refId),
      "--workspace",
      workspaceRoot,
      "--summary",
      "--json"
    ]);

    assert.equal(refResult.exitCode, 0);

    const refPayload = JSON.parse(refResult.stdout) as {
      result: {
        data: {
          kind: string;
          item: {
            refId: string;
          };
        };
      };
    };

    assert.equal(refPayload.result.data.item.refId, refId);
    assert.ok(["table", "reducer"].includes(refPayload.result.data.kind));
  });
});

test("CLI query scout returns combined high-signal overview", async () => {
  await withSpacetimeWorkspace(async (workspaceRoot) => {
    const result = await runCli(["query", "scout", "--workspace", workspaceRoot, "--json"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr.trim(), "");

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      tool: string;
      result: {
        mode: string;
        app: Record<string, unknown>;
        schema: {
          preview: Array<Record<string, unknown>>;
        };
        reducers: {
          preview: Array<Record<string, unknown>>;
        };
        next: string[];
      };
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.tool, "workflow.scout");
    assert.equal(payload.result.mode, "scout");
    assert.equal(payload.result.schema.preview.length > 0, true);
    assert.equal(payload.result.reducers.preview.length > 0, true);
    assert.equal(payload.result.next.length >= 2, true);
    assert.equal(payload.result.next.some((entry) => entry.includes("query symbols")), true);
  });
});
