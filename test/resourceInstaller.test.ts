import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installOrUpdateResources } from "../src/cli/resourceInstaller.js";

const TEST_VERSION = "0.6.0";

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-install-test-"));

  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("installOrUpdateResources install mode creates managed resources", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: TEST_VERSION
    });

    assert.equal(result.created.length, 7);
    assert.equal(result.updated.length, 0);
    assert.equal(result.skipped.length, 0);

    const mcpConfig = await readFile(path.join(workspaceRoot, ".mcp.json"), "utf8");
    const opencodeConfig = await readFile(path.join(workspaceRoot, "opencode.json"), "utf8");
    const antigravityConfig = await readFile(path.join(workspaceRoot, "mcp_config.json"), "utf8");
    const codexConfig = await readFile(path.join(workspaceRoot, ".codex/config.toml"), "utf8");
    const summaryConfig = await readFile(path.join(workspaceRoot, "spacetime-mcp.json"), "utf8");
    const guideline = await readFile(
      path.join(workspaceRoot, ".ai/guidelines/spacetimedb/core.md"),
      "utf8"
    );
    const skill = await readFile(
      path.join(workspaceRoot, ".ai/skills/spacetimedb-development/SKILL.md"),
      "utf8"
    );

    assert.equal(mcpConfig.includes("\"x-spacetime-mcp-managed\": true"), true);
    assert.equal(opencodeConfig.includes("\"$schema\": \"https://opencode.ai/config.json\""), true);
    assert.equal(antigravityConfig.includes("\"mcpServers\""), true);
    assert.equal(codexConfig.includes("[mcp_servers.spacetime-mcp]"), true);
    assert.equal(summaryConfig.includes("\"x-spacetime-mcp-managed\": true"), true);
    assert.equal(guideline.includes("spacetime-mcp-managed: true"), true);
    assert.equal(skill.includes("name: spacetimedb-development"), true);
  });
});

test("installOrUpdateResources update mode refreshes managed resources", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: TEST_VERSION
    });

    const guidelinePath = path.join(workspaceRoot, ".ai/guidelines/spacetimedb/core.md");
    const previous = await readFile(guidelinePath, "utf8");
    await writeFile(guidelinePath, `${previous}\nTemporary line`, "utf8");

    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: TEST_VERSION
    });

    assert.equal(result.updated.includes(".ai/guidelines/spacetimedb/core.md"), true);

    const refreshed = await readFile(guidelinePath, "utf8");
    assert.equal(refreshed.includes("Temporary line"), false);
  });
});

test("installOrUpdateResources merges into unmanaged JSON server configs", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const targetPath = path.join(workspaceRoot, ".mcp.json");
    await writeFile(
      targetPath,
      JSON.stringify(
        {
          mcpServers: {
            custom: {
              command: "node",
              args: ["custom.js"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const before = await readFile(targetPath, "utf8");
    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: TEST_VERSION
    });

    const after = await readFile(targetPath, "utf8");
    const parsed = JSON.parse(after) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    assert.notEqual(before, after);
    assert.equal(parsed.mcpServers.custom.command, "node");
    assert.equal(parsed.mcpServers["spacetime-mcp"].command, "npx");
    assert.equal(result.skipped.some((entry) => entry.path === ".mcp.json"), false);
  });
});

test("installOrUpdateResources respects target selection", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: TEST_VERSION,
      targets: ["codex"]
    });

    assert.deepEqual(result.targets, ["codex"]);
    assert.equal(result.created.includes(".codex/config.toml"), true);
    assert.equal(result.created.includes(".mcp.json"), false);
    assert.equal(result.created.includes("opencode.json"), false);
    assert.equal(result.created.includes("mcp_config.json"), false);
  });
});

test("installOrUpdateResources dry-run reports changes without writing files", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: TEST_VERSION,
      dryRun: true
    });

    assert.equal(result.created.length, 7);

    await assert.rejects(readFile(path.join(workspaceRoot, "spacetime-mcp.json"), "utf8"));
    await assert.rejects(readFile(path.join(workspaceRoot, ".mcp.json"), "utf8"));
  });
});

test("installOrUpdateResources is idempotent across repeated install runs", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: TEST_VERSION
    });

    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: TEST_VERSION
    });

    const codexConfig = await readFile(path.join(workspaceRoot, ".codex/config.toml"), "utf8");
    const sectionCount = codexConfig.match(/\[mcp_servers\.spacetime-mcp\]/g)?.length ?? 0;

    assert.equal(result.created.length, 0);
    assert.equal(result.updated.length, 0);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.unchanged.length, 7);
    assert.equal(sectionCount, 1);
  });
});

test("installOrUpdateResources skips malformed JSON config files safely", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const malformedPath = path.join(workspaceRoot, ".mcp.json");
    await writeFile(malformedPath, "{", "utf8");

    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: TEST_VERSION,
      targets: ["mcp"]
    });

    const after = await readFile(malformedPath, "utf8");
    const skippedEntry = result.skipped.find((entry) => entry.path === ".mcp.json");

    assert.equal(after, "{");
    assert.equal(skippedEntry?.reason, "existing file is not valid JSON");
  });
});

test("installOrUpdateResources skips JSON configs with invalid server collection shape", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const opencodePath = path.join(workspaceRoot, "opencode.json");
    await writeFile(opencodePath, JSON.stringify({ mcp: [] }, null, 2), "utf8");

    const before = await readFile(opencodePath, "utf8");
    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: TEST_VERSION,
      targets: ["opencode"]
    });

    const after = await readFile(opencodePath, "utf8");
    const skippedEntry = result.skipped.find((entry) => entry.path === "opencode.json");

    assert.equal(after, before);
    assert.equal(skippedEntry?.reason, 'key "mcp" is not an object');
  });
});
