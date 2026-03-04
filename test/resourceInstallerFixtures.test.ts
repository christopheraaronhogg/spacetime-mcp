import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installOrUpdateResources } from "../src/cli/resourceInstaller.js";
import { SPACETIME_MCP_VERSION } from "../src/version.js";

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-fixture-test-"));

  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("installOrUpdateResources preserves complex OpenCode config while updating spacetime server", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixturePath = path.join(fixturesRoot, "opencode", "complex-existing.json");
    const opencodePath = path.join(workspaceRoot, "opencode.json");
    const fixtureContent = await readFile(fixturePath, "utf8");

    await writeFile(opencodePath, fixtureContent, "utf8");

    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: SPACETIME_MCP_VERSION,
      targets: ["opencode"]
    });

    const updatedContent = await readFile(opencodePath, "utf8");
    const updatedConfig = JSON.parse(updatedContent) as {
      theme: string;
      agents: {
        default: string;
      };
      mcp: Record<string, { type: string; enabled: boolean; command: string[] }>;
    };

    assert.equal(result.updated.includes("opencode.json"), true);
    assert.equal(updatedConfig.theme, "solarized");
    assert.equal(updatedConfig.agents.default, "builder");
    assert.deepEqual(updatedConfig.mcp["workspace-tools"].command, [
      "node",
      "scripts/workspace-tools.js"
    ]);
    assert.equal(updatedConfig.mcp["spacetime-mcp"].type, "local");
    assert.equal(updatedConfig.mcp["spacetime-mcp"].enabled, true);
    assert.deepEqual(updatedConfig.mcp["spacetime-mcp"].command, [
      "npx",
      "-y",
      "spacetime-mcp",
      "mcp"
    ]);
  });
});

test("installOrUpdateResources preserves complex Codex config while replacing spacetime section", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixturePath = path.join(fixturesRoot, "codex", "complex-existing.toml");
    const codexPath = path.join(workspaceRoot, ".codex", "config.toml");
    const fixtureContent = await readFile(fixturePath, "utf8");

    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, fixtureContent, "utf8");

    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: SPACETIME_MCP_VERSION,
      targets: ["codex"]
    });

    const updatedContent = await readFile(codexPath, "utf8");
    const sectionCount = updatedContent.match(/\[mcp_servers\.spacetime-mcp\]/g)?.length ?? 0;

    assert.equal(result.updated.includes(".codex/config.toml"), true);
    assert.equal(sectionCount, 1);
    assert.equal(updatedContent.includes("legacy/spacetime.js"), false);
    assert.match(updatedContent, /\[mcp_servers\.workspace-tools\]/);
    assert.match(updatedContent, /\[profiles\.default\]/);
    assert.match(updatedContent, /command = "npx"/);
    assert.match(updatedContent, /args = \["-y", "spacetime-mcp", "mcp"\]/);
    assert.match(updatedContent, /cwd = "/);
  });
});
