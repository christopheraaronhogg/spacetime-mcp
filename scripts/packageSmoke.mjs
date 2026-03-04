import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmExecPath = process.env.npm_execpath;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function runCommand(command, args, cwd) {
  let child;

  try {
    child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to spawn command: ${command} ${args.join(" ")}\n${message}`);
  }

  let stdout = "";
  let stderr = "";

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", (error) => reject(error));
    child.once("close", (code) => resolve(code ?? -1));
  });

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `Exit code: ${exitCode}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `stderr:\n${stderr.trim()}` : ""
      ]
        .filter((entry) => entry.length > 0)
        .join("\n\n")
    );
  }

  return {
    stdout,
    stderr
  };
}

async function runNpmCommand(args, cwd) {
  if (npmExecPath) {
    return runCommand(process.execPath, [npmExecPath, ...args], cwd);
  }

  return runCommand(npmCommand, args, cwd);
}

function parseJsonPayload(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output, received empty output.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[") >= 0 ? trimmed.indexOf("[") : trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("]") >= 0 ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}");

    if (start < 0 || end < start) {
      throw new Error(`Unable to parse JSON payload from output:\n${trimmed}`);
    }

    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

async function main() {
  let smokeRoot;
  let tarballPath;
  const skipBuild = process.argv.includes("--skip-build");

  try {
    if (!skipBuild) {
      await runNpmCommand(["run", "build"], repoRoot);
    }

    const packResult = await runNpmCommand(["pack", "--json"], repoRoot);
    const packEntries = parseJsonPayload(packResult.stdout);
    const packEntry = Array.isArray(packEntries) ? packEntries[0] : undefined;

    assert.ok(packEntry && typeof packEntry.filename === "string", "npm pack did not return filename");

    tarballPath = path.join(repoRoot, packEntry.filename);

    smokeRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-package-smoke-"));
    const consumerRoot = path.join(smokeRoot, "consumer");
    const workspaceRoot = path.join(smokeRoot, "workspace");
    const installedCliPath = path.join(
      consumerRoot,
      "node_modules",
      "spacetime-mcp",
      "dist",
      "index.js"
    );

    await mkdir(consumerRoot, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });

    await writeFile(
      path.join(consumerRoot, "package.json"),
      JSON.stringify(
        {
          name: "spacetime-mcp-smoke",
          private: true,
          type: "module"
        },
        null,
        2
      ),
      "utf8"
    );

    await runNpmCommand(["install", "--no-audit", "--no-fund", tarballPath], consumerRoot);

    const installResult = await runCommand(
      process.execPath,
      [installedCliPath, "install", workspaceRoot, "--target", "codex", "--json"],
      consumerRoot
    );

    const installPayload = parseJsonPayload(installResult.stdout);
    assert.equal(installPayload.ok, true);
    assert.equal(installPayload.command, "install");
    assert.deepEqual(installPayload.result.targets, ["codex"]);
    assert.equal(installPayload.result.created.includes(".codex/config.toml"), true);

    const codexConfig = await readFile(path.join(workspaceRoot, ".codex", "config.toml"), "utf8");
    assert.match(codexConfig, /\[mcp_servers\.spacetime-mcp\]/);

    const updateResult = await runCommand(
      process.execPath,
      [installedCliPath, "update", workspaceRoot, "--target", "codex", "--dry-run", "--json"],
      consumerRoot
    );

    const updatePayload = parseJsonPayload(updateResult.stdout);
    assert.equal(updatePayload.ok, true);
    assert.equal(updatePayload.command, "update");
    assert.equal(updatePayload.result.dryRun, true);

    console.log("Package smoke test passed.");
  } finally {
    if (tarballPath) {
      await rm(tarballPath, { force: true });
    }

    if (smokeRoot) {
      await rm(smokeRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Package smoke test failed: ${message}`);
  process.exitCode = 1;
});
