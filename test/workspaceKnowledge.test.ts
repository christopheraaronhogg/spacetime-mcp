import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findWorkspaceSkill,
  listWorkspaceSkills,
  loadWorkspaceGuidelines
} from "../src/context/workspaceKnowledge.js";

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spacetime-mcp-knowledge-test-"));

  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  source: string
): Promise<void> {
  const fullPath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, source, "utf8");
}

test("loadWorkspaceGuidelines loads markdown from workspace guideline folders", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeWorkspaceFile(
      workspaceRoot,
      ".ai/guidelines/reducers.md",
      `# Reducer Rules\n\n- Keep reducer names verb-first.`
    );

    await writeWorkspaceFile(
      workspaceRoot,
      ".spacetime/guidelines/perf.md",
      `# Performance\n\n- Add indexes on frequent lookup fields.`
    );

    const guidelines = await loadWorkspaceGuidelines(workspaceRoot);

    assert.equal(guidelines.length, 2);
    assert.deepEqual(
      guidelines.map((guideline) => guideline.title),
      ["Reducer Rules", "Performance"]
    );
    assert.equal(guidelines.every((guideline) => guideline.source === "workspace"), true);
  });
});

test("listWorkspaceSkills and findWorkspaceSkill read skill metadata", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeWorkspaceFile(
      workspaceRoot,
      ".ai/skills/inventory-trading/SKILL.md",
      `---
name: inventory-trading
description: Build reducer flows for item trades.
---

# Inventory Trading Skill

- Validate ownership before transfer.
`
    );

    const skills = await listWorkspaceSkills(workspaceRoot);
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, "inventory-trading");
    assert.equal(skills[0]?.description, "Build reducer flows for item trades.");

    const skill = await findWorkspaceSkill(workspaceRoot, "INVENTORY-TRADING");
    assert.equal(skill?.name, "inventory-trading");
    assert.equal(skill?.content.includes("Validate ownership"), true);
  });
});
