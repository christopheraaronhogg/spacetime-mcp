import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
  }

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

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-cli-test-"));

  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("CLI install supports target and dry-run flags", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["install", workspaceRoot, "--target", "codex", "--dry-run"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /spacetime-mcp install \(dry-run\) complete:/);
    assert.match(result.stdout, /targets: codex/);

    await assert.rejects(readFile(path.join(workspaceRoot, ".codex/config.toml"), "utf8"));
    await assert.rejects(readFile(path.join(workspaceRoot, "spacetime-mcp.json"), "utf8"));
  });
});

test("CLI install emits machine-readable JSON output", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["install", workspaceRoot, "--target", "codex", "--dry-run", "--json"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr.trim(), "");

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      result: {
        dryRun: boolean;
        targets: string[];
      };
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.command, "install");
    assert.equal(payload.result.dryRun, true);
    assert.deepEqual(payload.result.targets, ["codex"]);
  });
});

test("CLI install writes only selected target config files", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["install", workspaceRoot, "--target", "mcp,opencode"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /targets: mcp, opencode/);

    const mcpConfig = await readFile(path.join(workspaceRoot, ".mcp.json"), "utf8");
    const opencodeConfig = await readFile(path.join(workspaceRoot, "opencode.json"), "utf8");

    assert.match(mcpConfig, /"spacetime-mcp"/);
    assert.match(opencodeConfig, /"spacetime-mcp"/);

    await assert.rejects(readFile(path.join(workspaceRoot, ".codex/config.toml"), "utf8"));
    await assert.rejects(readFile(path.join(workspaceRoot, "mcp_config.json"), "utf8"));
  });
});

test("CLI install fails with invalid target values", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["install", workspaceRoot, "--target", "invalid"]);

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /spacetime-mcp failed \[ERR_INVALID_TARGET\]: Invalid target\(s\): invalid/);

    await assert.rejects(readFile(path.join(workspaceRoot, "spacetime-mcp.json"), "utf8"));
  });
});

test("CLI install returns JSON error payload when --json is requested", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["install", workspaceRoot, "--target", "invalid", "--json"]);

    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.trim(), "");

    const payload = JSON.parse(result.stderr) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "ERR_INVALID_TARGET");
    assert.equal(payload.error.message, "Invalid target(s): invalid");
  });
});

test("CLI install fails when --target value is missing", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["install", workspaceRoot, "--target"]);

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /spacetime-mcp failed \[ERR_MISSING_OPTION_VALUE\]: --target requires a value/);
  });
});

test("CLI default mode rejects unknown options with usage exit code", async () => {
  const result = await runCli(["--unknown"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /spacetime-mcp failed \[ERR_UNKNOWN_OPTION\]: Unknown option: --unknown/);
});

test("CLI mcp command rejects extra positional arguments", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCli(["mcp", workspaceRoot, "extra"]);

    assert.equal(result.exitCode, 2);
    assert.match(
      result.stderr,
      /spacetime-mcp failed \[ERR_UNEXPECTED_ARGUMENT\]: Unexpected extra argument: extra/
    );
  });
});

test("CLI update reports skipped malformed JSON configs", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const malformedPath = path.join(workspaceRoot, ".mcp.json");
    await writeFile(malformedPath, "{", "utf8");

    const result = await runCli(["update", workspaceRoot, "--target", "mcp"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /skipped: \.mcp\.json \(existing file is not valid JSON\)/);

    const after = await readFile(malformedPath, "utf8");
    assert.equal(after, "{");
  });
});
