import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BlueprintViewerService } from "../../src/services/blueprint-viewer-service.js";
import { type BlueprintOutput } from "../../src/tools/compose/compose.types.js";

async function writeViewerFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "blueprint-viewer-service-"));
  await mkdir(join(projectRoot, ".blueprint", "groups"), { recursive: true });
  await writeFile(
    join(projectRoot, ".blueprint", "blueprint-output.json"),
    JSON.stringify(createBlueprintOutput(), null, 2),
    "utf-8",
  );
  await writeFile(
    join(projectRoot, ".blueprint", "groups", "runtime.md"),
    [
      "---",
      "id: group-runtime",
      "type: group-note",
      "groupId: runtime",
      "status: ready",
      "source: llm-authored",
      "---",
      "",
      "# Runtime",
      "",
      "## Snapshot",
      "Owns runtime startup.",
      "",
      "## Responsibilities",
      "- Register tools.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return projectRoot;
}

function createBlueprintOutput(): BlueprintOutput {
  return {
    schemaVersion: "blueprint.v1",
    project: {
      analysisArtifactId: "analysis_1",
      inventoryArtifactId: "inventory_1",
    },
    groups: [
      {
        id: "runtime",
        name: "Runtime",
        kind: "runtime",
        summary: "Owns MCP registration.",
        docsPath: ".blueprint/groups/runtime.md",
        fileIds: ["file_index"],
      },
      {
        id: "docs",
        name: "Documentation",
        kind: "documentation",
        summary: "Owns docs.",
        docsPath: ".blueprint/groups/docs.md",
        fileIds: ["file_readme"],
      },
    ],
    files: [
      {
        id: "file_index",
        path: "src/index.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        notesStatus: "not-required",
        role: "entrypoint",
      },
      {
        id: "file_readme",
        path: "README.md",
        groupId: "docs",
        category: "documentation",
        language: "markdown",
        notesStatus: "not-required",
      },
    ],
    edges: [
      {
        fromGroupId: "runtime",
        toGroupId: "docs",
        type: "references",
        count: 1,
      },
    ],
    fileEdges: [],
    symbols: [],
    entrypoints: [],
    testLinks: [],
    validation: {
      isValid: true,
      groupingComplete: true,
      groupingIssueSummary: [],
      groupingWarningSummary: [],
    },
  };
}

describe("BlueprintViewerService", () => {
  it("builds overview and group detail payloads from hidden .blueprint memory", async () => {
    const service = new BlueprintViewerService();
    const projectRoot = await writeViewerFixture();

    const result = await service.viewerData(projectRoot);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.payload.overview.groups.map((group) => group.id)).toEqual(["runtime", "docs"]);
    expect(result.payload.overview.groups[0]).toMatchObject({
      id: "runtime",
      docsStatus: "ready",
      connections: [
        {
          groupId: "docs",
          direction: "outgoing",
          type: "references",
          count: 1,
        },
      ],
    });
    expect(result.payload.details.runtime.group).toMatchObject({
      id: "runtime",
      docsPath: ".blueprint/groups/runtime.md",
      fileCount: 1,
    });
    expect(result.payload.details.runtime.doc.sections).toMatchObject({
      snapshot: "Owns runtime startup.",
      responsibilities: "- Register tools.",
    });
    expect(result.payload.details.docs.doc).toMatchObject({
      exists: false,
      validation: { warnings: ["group docs not found"] },
    });
  });
});
