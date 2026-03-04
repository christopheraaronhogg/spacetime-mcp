import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installOrUpdateResources } from "../src/cli/resourceInstaller.js";

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
      version: "0.5.0"
    });

    assert.equal(result.created.length, 4);
    assert.equal(result.updated.length, 0);
    assert.equal(result.skipped.length, 0);

    const mcpConfig = await readFile(path.join(workspaceRoot, ".mcp.json"), "utf8");
    const guideline = await readFile(
      path.join(workspaceRoot, ".ai/guidelines/spacetimedb/core.md"),
      "utf8"
    );
    const skill = await readFile(
      path.join(workspaceRoot, ".ai/skills/spacetimedb-development/SKILL.md"),
      "utf8"
    );

    assert.equal(mcpConfig.includes("\"x-spacetime-mcp-managed\": true"), true);
    assert.equal(guideline.includes("spacetime-mcp-managed: true"), true);
    assert.equal(skill.includes("name: spacetimedb-development"), true);
  });
});

test("installOrUpdateResources update mode refreshes managed resources", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await installOrUpdateResources({
      workspaceRoot,
      mode: "install",
      version: "0.5.0"
    });

    const guidelinePath = path.join(workspaceRoot, ".ai/guidelines/spacetimedb/core.md");
    const previous = await readFile(guidelinePath, "utf8");
    await writeFile(guidelinePath, `${previous}\nTemporary line`, "utf8");

    const result = await installOrUpdateResources({
      workspaceRoot,
      mode: "update",
      version: "0.5.0"
    });

    assert.equal(result.updated.includes(".ai/guidelines/spacetimedb/core.md"), true);

    const refreshed = await readFile(guidelinePath, "utf8");
    assert.equal(refreshed.includes("Temporary line"), false);
  });
});

test("installOrUpdateResources skips unmanaged files", async () => {
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
      version: "0.5.0"
    });

    const after = await readFile(targetPath, "utf8");

    assert.equal(before, after);
    assert.equal(result.skipped.some((entry) => entry.path === ".mcp.json"), true);
  });
});
