import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { ComposeTool } from "../../src/tools/compose/index.js";
import { ComposeArtifactWriter } from "../../src/tools/compose/compose-artifact-writer.js";
import { ComposeEntrypointDetector } from "../../src/tools/compose/compose-entrypoint-detector.js";
import { ComposeOutputBuilder } from "../../src/tools/compose/compose-output-builder.js";
import { GroupTool } from "../../src/tools/group/index.js";
import { GroupingAssignmentEngine } from "../../src/tools/group/grouping-assignment-engine.js";
import { GroupingPlanValidator } from "../../src/tools/group/grouping-plan-validator.js";
import { ScanTool } from "../../src/tools/scan/index.js";
import { CodeAnalysisEngine } from "../../src/tools/scan/scan-code-analysis-engine.js";
import { FileInventoryBuilder } from "../../src/tools/scan/scan-file-inventory-builder.js";
import { parseJsonToolResult } from "../../src/types.js";

function createPipelineTools(): {
  scanTool: ScanTool;
  groupTool: GroupTool;
  composeTool: ComposeTool;
} {
  return {
    scanTool: new ScanTool(new FileInventoryBuilder(), new CodeAnalysisEngine()),
    groupTool: new GroupTool(
      new GroupingPlanValidator(),
      new GroupingAssignmentEngine(),
    ),
    composeTool: new ComposeTool(
      new ComposeOutputBuilder(new ComposeEntrypointDetector()),
      new ComposeArtifactWriter(),
    ),
  };
}

interface ScanResponse {
  artifactId: string;
}

interface GroupApplyResponse {
  artifactId: string;
  validation: {
    isComplete: boolean;
    warningIssues: string[];
    unknownPatterns: Array<{
      pattern: string;
      reason: string;
      suggestions: string[];
    }>;
  };
  next: {
    tool: "blueprint.compose";
    input: {
      groupingArtifactId: string;
    };
  };
}

interface ComposeResponse {
  validation: {
    isValid: boolean;
    groupingComplete: boolean;
    groupingIssueSummary: string[];
    groupingWarningSummary: string[];
  };
  output: {
    schemaVersion: "blueprint.v1";
    project: {
      summary?: string;
    };
    groups: Array<{ id: string; summary?: string }>;
    validation: {
      groupingWarningSummary: string[];
    };
  };
}

async function createHappyPathRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blueprint-pipeline-happy-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf-8");
  await writeFile(join(root, ".mcp.json"), "{ \"server\": \"blueprint\" }\n", "utf-8");
  await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf-8");
  await writeFile(join(root, "README.md"), "# Fixture\n", "utf-8");
  await writeFile(join(root, "src", "helper.ts"), "export function helper() { return 42; }\n", "utf-8");
  await writeFile(
    join(root, "src", "index.ts"),
    "import { helper } from './helper.js';\nexport const value = helper();\n",
    "utf-8",
  );
  return root;
}

async function createWarningPathRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blueprint-pipeline-warning-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, ".gitignore"),
    "node_modules/\ndocs\n*.json\n.env\n!.mcp.json\n",
    "utf-8",
  );
  await writeFile(join(root, ".mcp.json"), "{ \"server\": \"blueprint\" }\n", "utf-8");
  await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf-8");
  await writeFile(join(root, "README.md"), "# Fixture\n", "utf-8");
  await writeFile(join(root, ".env"), "SECRET=1\n", "utf-8");
  await writeFile(join(root, "blueprint-output.json"), "{}\n", "utf-8");
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "PLAN.md"), "# Ignored\n", "utf-8");
  await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n", "utf-8");
  return root;
}

describe("blueprint pipeline end-to-end", () => {
  it("runs scan -> group -> compose successfully on the happy path", async () => {
    const { scanTool, groupTool, composeTool } = createPipelineTools();
    const store = new ArtifactStore();
    const rootPath = await createHappyPathRepo();

    const scan = parseJsonToolResult<ScanResponse>(await scanTool.handle({ rootPath }, store));
    const groupApply = parseJsonToolResult<GroupApplyResponse>(
      await groupTool.handle({
        mode: "apply",
        analysisArtifactId: scan.artifactId,
        plan: {
          project: {
            summary: "Fixture project for validating the direct Blueprint pipeline.",
          },
          groups: [
            { id: "runtime", name: "Runtime", description: "Runs source code.", include: ["src/**"] },
            { id: "documentation", name: "Documentation", description: "Holds project notes.", include: ["*.md"] },
            { id: "config", name: "Config", description: "Holds project configuration.", include: ["package.json", ".gitignore", ".mcp.json"] },
          ],
          fallback: { strategy: "folder-category" },
        },
      }, store),
    );

    expect(groupApply.validation.isComplete).toBe(true);
    expect(groupApply.next).toEqual({
      tool: "blueprint.compose",
      input: { groupingArtifactId: groupApply.artifactId },
    });

    const compose = parseJsonToolResult<ComposeResponse>(
      await composeTool.handle({ groupingArtifactId: groupApply.artifactId }, store),
    );

    expect(compose.validation).toEqual({
      isValid: true,
      groupingComplete: true,
      groupingIssueSummary: [],
      groupingWarningSummary: [],
    });
    expect(compose.output.schemaVersion).toBe("blueprint.v1");
    expect(compose.output.project.summary).toBe("Fixture project for validating the direct Blueprint pipeline.");
    expect(compose.output.groups.map((group) => group.id)).toEqual([
      "config",
      "documentation",
      "runtime",
    ]);
    expect(compose.output.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "runtime", summary: "Runs source code." }),
      ]),
    );
  });

  it("keeps compose valid while carrying grouping warnings through the direct pipeline", async () => {
    const { scanTool, groupTool, composeTool } = createPipelineTools();
    const store = new ArtifactStore();
    const rootPath = await createWarningPathRepo();

    const scan = parseJsonToolResult<ScanResponse>(await scanTool.handle({ rootPath }, store));
    const groupApply = parseJsonToolResult<GroupApplyResponse>(
      await groupTool.handle({
        mode: "apply",
        analysisArtifactId: scan.artifactId,
        plan: {
          project: { summary: "Fixture project with ignored files." },
          groups: [
            { id: "runtime", name: "Runtime", include: ["src/**", "docs/**", "blueprint-output*.json"] },
            { id: "docs", name: "Docs", include: ["*.md"] },
            { id: "config", name: "Config", include: ["package.json", ".gitignore", ".mcp.json", ".env"] },
          ],
          fallback: { strategy: "folder-category" },
        },
      }, store),
    );

    expect(groupApply.validation.isComplete).toBe(true);
    expect(groupApply.validation.warningIssues).toContain("unknownPatterns");
    expect(groupApply.validation.unknownPatterns).toEqual(
      expect.arrayContaining([
        {
          pattern: "docs/**",
          reason: "matched no inventory files; the path may be ignored or not inventoried",
          suggestions: [],
        },
        {
          pattern: "blueprint-output*.json",
          reason: "matched no inventory files; the path may be ignored or not inventoried",
          suggestions: [],
        },
        {
          pattern: ".env",
          reason: "matched no inventory files; the path may be ignored or not inventoried",
          suggestions: [],
        },
      ]),
    );

    const compose = parseJsonToolResult<ComposeResponse>(
      await composeTool.handle({ groupingArtifactId: groupApply.artifactId }, store),
    );

    expect(compose.validation).toEqual({
      isValid: true,
      groupingComplete: true,
      groupingIssueSummary: [],
      groupingWarningSummary: ["unknownPatterns"],
    });
    expect(compose.output.validation.groupingWarningSummary).toEqual(["unknownPatterns"]);
  });
});
