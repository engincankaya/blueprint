import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { sha256 } from "../../src/lib/hashing.js";
import { ComposeTool } from "../../src/tools/compose/index.js";
import { ComposeArtifactWriter } from "../../src/tools/compose/compose-artifact-writer.js";
import { ComposeEntrypointDetector } from "../../src/tools/compose/compose-entrypoint-detector.js";
import { ComposeOutputBuilder } from "../../src/tools/compose/compose-output-builder.js";
import { type GroupingResult } from "../../src/tools/group/grouping.types.js";
import { type AnalysisFacts } from "../../src/tools/scan/scan-code-analysis-engine.js";
import { type FileInventory } from "../../src/tools/scan/scan-file-inventory-builder.js";
import { parseJsonToolResult } from "../../src/types.js";

function createComposeTool(): ComposeTool {
  return new ComposeTool(
    new ComposeOutputBuilder(new ComposeEntrypointDetector()),
    new ComposeArtifactWriter(),
  );
}

const readmeSource = "# Fixture\n";
const testSource = "import { handler } from '../src/index.js';\ntest('handler', () => handler());\n";
function contentHash(source: string): string {
  return sha256(Buffer.from(source).toString("base64"));
}

function createGroupingResult(
  inventoryArtifactId = "inventory_1",
  analysisArtifactId = "analysis_1",
): GroupingResult {
  return {
    analysisArtifactId,
    inventoryArtifactId,
    project: {
      summary: "Fixture project that runs a runtime entrypoint with documentation support.",
      purpose: "Validate Blueprint compose output.",
      architecture: "Runtime and documentation groups are connected through a small dependency graph.",
    },
    groups: [
      {
        id: "runtime",
        name: "Runtime",
        kind: "runtime",
        description: "Runs the application entrypoint.",
        files: [
          {
            fileId: "file_index",
            path: "src/index.ts",
            category: "source",
            language: "typescript",
            role: "entrypoint",
            importance: "unknown",
          },
          {
            fileId: "file_index_test",
            path: "tests/index.test.ts",
            category: "test",
            language: "typescript",
            role: "unknown",
            importance: "unknown",
          },
        ],
      },
      {
        id: "docs",
        name: "Documentation",
        kind: "documentation",
        files: [
          {
            fileId: "file_readme",
            path: "README.md",
            category: "documentation",
            language: "markdown",
            role: "unknown",
            importance: "unknown",
          },
        ],
      },
    ],
    crossGroupEdges: [
      { fromGroupId: "runtime", toGroupId: "docs", type: "references", count: 1 },
    ],
    internalDependencyEdges: [],
    validation: {
      isComplete: true,
      isAssignedCompletely: true,
      hasWarnings: false,
      blockingIssues: [],
      warningIssues: [],
      inventoryFiles: 2,
      assignedFiles: 2,
      unassignedFiles: [],
      duplicateAssignments: [],
      emptyGroups: [],
      unknownPatterns: [],
      fallbackAssignments: [],
    },
  };
}

function createInventory(rootPath: string): FileInventory {
  return {
    rootPath,
    options: {
      maxFiles: 10000,
      ignore: [],
      respectGitignore: true,
      includeDefaultIgnored: false,
    },
    project: {
      name: "fixture",
      rootPath,
      detectedStack: ["typescript"],
      packageManagers: ["npm"],
    },
    files: [
      {
        fileId: "file_index",
        path: "src/index.ts",
        absolutePath: join(rootPath, "src/index.ts"),
        language: "typescript",
        sizeBytes: 10,
        hash: "hash-index",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_readme",
        path: "README.md",
        absolutePath: join(rootPath, "README.md"),
        language: "markdown",
        sizeBytes: 10,
        hash: contentHash(readmeSource),
        category: "documentation",
        analysisLevel: "metadata-only",
        parseable: false,
      },
      {
        fileId: "file_index_test",
        path: "tests/index.test.ts",
        absolutePath: join(rootPath, "tests/index.test.ts"),
        language: "typescript",
        sizeBytes: 10,
        hash: contentHash(testSource),
        category: "test",
        analysisLevel: "parseable",
        parseable: true,
      },
    ],
    summary: {
      totalFiles: 3,
      parseableFiles: 2,
      metadataOnlyFiles: 1,
      truncated: false,
      languages: {
        typescript: 2,
        markdown: 1,
      },
      categories: {
        source: 1,
        test: 1,
        config: 0,
        documentation: 1,
        asset: 0,
        lockfile: 0,
        generated: 0,
        script: 0,
        unknown: 0,
      },
      analysisLevels: {
        parseable: 2,
        "metadata-only": 1,
      },
      topLevelDirs: ["src"],
    },
    validation: {
      isComplete: true,
      scannedFiles: 3,
      inventoriedFiles: 3,
      missingFiles: [],
      duplicatePaths: [],
      duplicateFileIds: [],
    },
  };
}

function createAnalysisFacts(
  inventoryArtifactId: string,
  rootPath: string,
): AnalysisFacts {
  return {
    inventoryArtifactId,
    rootPath,
    files: {
      file_index: {
        fileId: "file_index",
        path: "src/index.ts",
        language: "typescript",
        imports: ["../README.md"],
        exports: ["handler"],
        symbols: ["symbol_handler"],
      },
      file_index_test: {
        fileId: "file_index_test",
        path: "tests/index.test.ts",
        language: "typescript",
        imports: ["../src/index.js"],
        exports: [],
        symbols: [],
      },
    },
    symbols: {
      symbol_handler: {
        symbolId: "symbol_handler",
        fileId: "file_index",
        name: "handler",
        kind: "function",
        startLine: 3,
        endLine: 5,
        signature: "export async function handler()",
      },
    },
    imports: [
      {
        fileId: "file_index",
        rawSpecifier: "../README.md",
        kind: "import",
        importedSymbols: ["README"],
      },
      {
        fileId: "file_index_test",
        rawSpecifier: "../src/index.js",
        kind: "import",
        importedSymbols: ["handler"],
      },
    ],
    exports: [
      {
        fileId: "file_index",
        kind: "named",
        exportedSymbols: ["handler"],
      },
    ],
    dependencies: [
      {
        fromFileId: "file_index",
        toFileId: "file_readme",
        type: "imports",
        symbols: ["README"],
      },
      {
        fromFileId: "file_index_test",
        toFileId: "file_index",
        type: "imports",
        symbols: ["handler"],
      },
    ],
    unresolvedImports: [],
    parseErrors: [],
    summary: {
      totalFiles: 3,
      parseableFiles: 2,
      metadataOnlyFiles: 1,
      plannedFiles: 2,
      parsedFiles: 2,
      symbols: 1,
      imports: 2,
      exports: 1,
      dependencies: 2,
      parseErrors: 0,
    },
    validation: {
      isComplete: true,
      inventoryFiles: 3,
      parseableFiles: 2,
      parsedFiles: 2,
      metadataOnlyFiles: 1,
      skippedMetadataOnlyFiles: 1,
      parseErrors: 0,
      unaccountedFiles: [],
    },
  };
}

interface ComposeResponse {
  artifactId: string;
  summary: {
    groups: number;
    files: number;
    edges: number;
  };
  validation: {
    isValid: boolean;
    groupingComplete: boolean;
    groupingIssueSummary: string[];
    groupingWarningSummary: string[];
  };
  assistantNextSteps: Array<{
    kind: "hydrate-group-docs";
    required: boolean;
    executionPolicy: "must_execute_before_final_response" | "optional";
    reason: "group-docs-created-or-incomplete" | "group-docs-current";
    blockingReason?: string;
    message: string;
    parallelization: "one-sub-agent-per-group-doc";
    rules: string[];
    targets: Array<{
      groupId: string;
      groupName: string;
      docsPath: string;
      fileIds: string[];
      filePaths: string[];
      status: "missing" | "incomplete" | "current" | "unknown";
    }>;
  }>;
  output: {
    schemaVersion: "blueprint.v1";
    project: {
      analysisArtifactId: string;
      inventoryArtifactId: string;
      language: string;
      summary?: string;
      purpose?: string;
      architecture?: string;
    };
    groups: Array<{
      id: string;
      name: string;
      kind?: string;
      summary?: string;
      docsPath: string;
      fileIds: string[];
    }>;
    files: Array<{
      id: string;
      path: string;
      groupId: string;
      category: string;
      language: string;
      docsPath?: string;
      notesStatus: "missing" | "not-required";
      summary?: string;
      role?: string;
    }>;
    edges: Array<{
      fromGroupId: string;
      toGroupId: string;
      type: string;
      count: number;
    }>;
    fileEdges: Array<{
      fromFileId: string;
      toFileId: string;
      fromPath: string;
      toPath: string;
      type: string;
      symbols: string[];
    }>;
    symbols: Array<{
      id: string;
      fileId: string;
      path: string;
      name: string;
      kind: string;
      signature?: string;
      startLine?: number;
      endLine?: number;
      exported: boolean;
    }>;
    entrypoints: Array<{
      kind: string;
      name: string;
      handler: string;
      path: string;
      registrationPath: string;
    }>;
    testLinks: Array<{
      sourceFileId: string;
      sourcePath: string;
      testFileId: string;
      testPath: string;
      confidence: number;
      reasons: string[];
    }>;
    validation: {
      isValid: boolean;
      groupingComplete: boolean;
      groupingIssueSummary: string[];
      groupingWarningSummary: string[];
    };
  };
}

describe("blueprint.compose", () => {
  it("returns a clear error when the grouping artifact is missing", async () => {
    const store = new ArtifactStore();

    const result = await createComposeTool().handle({
      groupingArtifactId: "missing",
    }, store);

    expect(() => parseJsonToolResult<ComposeResponse>(result)).toThrow(
      "Grouping artifact missing not found",
    );
  });

  it("composes frontend-ready blueprint output and stores it as an artifact", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-graph-"));
    await mkdir(join(rootPath, "src"), { recursive: true });
    await mkdir(join(rootPath, "src", "tools"), { recursive: true });
    await mkdir(join(rootPath, "tests"), { recursive: true });
    await writeFile(join(rootPath, "README.md"), readmeSource, "utf-8");
    await writeFile(
      join(rootPath, "src", "tools", "run.ts"),
      "export async function handler() { return undefined; }\n",
      "utf-8",
    );
    await writeFile(
      join(rootPath, "src", "index.ts"),
      [
        "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
        "import { handler } from './tools/run.js';",
        "const server = new McpServer({ name: 'fixture', version: '0.1.0' });",
        "server.registerTool('fixture.run', { title: 'Run fixture' }, async (args) => handler(args));",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      join(rootPath, "tests", "index.test.ts"),
      testSource,
      "utf-8",
    );
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId, rootPath),
      "analysis",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId, analysisArtifactId),
      "grouping",
    );

    const response = parseJsonToolResult<ComposeResponse>(
      await createComposeTool().handle({ groupingArtifactId }, store),
    );

    expect(response.summary).toEqual({
      groups: 2,
      files: 3,
      edges: 1,
    });
    expect(response.validation).toEqual({
      isValid: true,
      groupingComplete: true,
      groupingIssueSummary: [],
      groupingWarningSummary: [],
    });
    expect(response.assistantNextSteps).toEqual([
      expect.objectContaining({
        kind: "hydrate-group-docs",
        required: true,
        executionPolicy: "must_execute_before_final_response",
        reason: "group-docs-created-or-incomplete",
        blockingReason: "Group docs are templates or unavailable and must be hydrated before reporting Blueprint compose as complete.",
        message: "Execute this step now before finalizing the user response. Spawn one sub-agent per target group doc and fill it from Blueprint facts plus source evidence. Do not ask the user unless the step is impossible.",
        parallelization: "one-sub-agent-per-group-doc",
        targets: [
          {
            groupId: "docs",
            groupName: "Documentation",
            docsPath: ".blueprint/groups/docs.md",
            fileIds: ["file_readme"],
            filePaths: ["README.md"],
            status: "incomplete",
          },
          {
            groupId: "runtime",
            groupName: "Runtime",
            docsPath: ".blueprint/groups/runtime.md",
            fileIds: ["file_index", "file_index_test"],
            filePaths: ["src/index.ts", "tests/index.test.ts"],
            status: "incomplete",
          },
        ],
      }),
    ]);
    expect(response.output).toEqual({
      schemaVersion: "blueprint.v1",
      project: {
        analysisArtifactId,
        inventoryArtifactId,
        language: "English",
        summary: "Fixture project that runs a runtime entrypoint with documentation support.",
        purpose: "Validate Blueprint compose output.",
        architecture: "Runtime and documentation groups are connected through a small dependency graph.",
      },
      groups: [
        {
          id: "docs",
          name: "Documentation",
          kind: "documentation",
          docsPath: ".blueprint/groups/docs.md",
          fileIds: ["file_readme"],
        },
        {
          id: "runtime",
          name: "Runtime",
          kind: "runtime",
          summary: "Runs the application entrypoint.",
          docsPath: ".blueprint/groups/runtime.md",
          fileIds: ["file_index", "file_index_test"],
        },
      ],
      files: [
        {
          id: "file_readme",
          path: "README.md",
          groupId: "docs",
          category: "documentation",
          language: "markdown",
          notesStatus: "not-required",
        },
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
          id: "file_index_test",
          path: "tests/index.test.ts",
          groupId: "runtime",
          category: "test",
          language: "typescript",
          notesStatus: "not-required",
        },
      ],
      edges: [
        { fromGroupId: "runtime", toGroupId: "docs", type: "references", count: 1 },
      ],
      fileEdges: [
        {
          fromFileId: "file_index",
          toFileId: "file_readme",
          fromPath: "src/index.ts",
          toPath: "README.md",
          type: "imports",
          symbols: ["README"],
        },
        {
          fromFileId: "file_index_test",
          toFileId: "file_index",
          fromPath: "tests/index.test.ts",
          toPath: "src/index.ts",
          type: "imports",
          symbols: ["handler"],
        },
      ],
      symbols: [
        {
          id: "symbol_handler",
          fileId: "file_index",
          path: "src/index.ts",
          name: "handler",
          kind: "function",
          signature: "export async function handler()",
          startLine: 3,
          endLine: 5,
          exported: true,
        },
      ],
      entrypoints: [
        {
          kind: "mcp-tool",
          name: "fixture.run",
          handler: "handler",
          path: "src/tools/run.ts",
          registrationPath: "src/index.ts",
        },
      ],
      testLinks: [
        {
          sourceFileId: "file_index",
          sourcePath: "src/index.ts",
          testFileId: "file_index_test",
          testPath: "tests/index.test.ts",
          confidence: 0.95,
          reasons: ["imports-source", "name-match"],
        },
      ],
      validation: {
        isValid: true,
        groupingComplete: true,
        groupingIssueSummary: [],
        groupingWarningSummary: [],
      },
    });

    const artifact = store.get(response.artifactId);
    expect(artifact?.type).toBe("blueprintOutput");
    expect(artifact?.data).toEqual(response.output);
  });

  it("stores the requested Blueprint content language in project metadata", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-language-"));
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId),
      "grouping",
    );

    const response = parseJsonToolResult<ComposeResponse>(
      await createComposeTool().handle({
        groupingArtifactId,
        language: "Turkish",
      }, store),
    );

    expect(response.output.project.language).toBe("Turkish");
    const written = JSON.parse(
      await readFile(join(rootPath, ".blueprint", "blueprint-output.json"), "utf-8"),
    ) as ComposeResponse["output"];
    expect(written.project.language).toBe("Turkish");
  });

  it("writes blueprint-output.json under the hidden .blueprint directory", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-"));
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId),
      "grouping",
    );

    const response = parseJsonToolResult<ComposeResponse>(
      await createComposeTool().handle({ groupingArtifactId }, store),
    );
    const written = JSON.parse(
      await readFile(join(rootPath, ".blueprint", "blueprint-output.json"), "utf-8"),
    );

    expect(written).toEqual(response.output);
  });

  it("writes the Markdown brief when compose writes blueprint-output.json", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-brief-"));
    await mkdir(join(rootPath, "src"), { recursive: true });
    await mkdir(join(rootPath, "src", "tools"), { recursive: true });
    await writeFile(
      join(rootPath, "src", "tools", "run.ts"),
      "export async function handler() { return undefined; }\n",
      "utf-8",
    );
    await writeFile(
      join(rootPath, "src", "index.ts"),
      [
        "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
        "import { handler } from './tools/run.js';",
        "const server = new McpServer({ name: 'fixture', version: '0.1.0' });",
        "server.registerTool('fixture.run', { title: 'Run fixture' }, async (args) => handler(args));",
      ].join("\n"),
      "utf-8",
    );
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId, rootPath),
      "analysis",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId, analysisArtifactId),
      "grouping",
    );

    await createComposeTool().handle({ groupingArtifactId }, store);

    const brief = await readFile(join(rootPath, ".blueprint", "brief.md"), "utf-8");
    expect(brief).toContain("# Project Blueprint Brief");
    expect(brief).toContain("## How To Route A Task");
    expect(brief).toContain("## Group Index");
    expect(brief).toContain("### Runtime");
    expect(brief).toContain("- read when:");
    expect(brief).toContain("read when: runtime");
    expect(brief).toContain("- docs: `.blueprint/groups/runtime.md`");
    expect(brief).toContain("- start files:");
    expect(brief).toContain("src/index.ts - entrypoint");
    expect(brief).toContain("- entrypoints:");
    expect(brief).toContain("fixture.run -> src/tools/run.ts");
    expect(brief).toContain("- related: docs (references: 1)");
    expect(brief).toContain("Read source files only after the relevant group docs are insufficient or code changes are required.");
    expect(brief).not.toContain("Doc sections:");
    expect(brief).not.toContain("lines 3-5");
  });

  it("writes only blueprint-output.json, brief.md, and group Markdown notes", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-output-contract-"));
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId),
      "grouping",
    );

    await createComposeTool().handle({ groupingArtifactId }, store);

    await expect(readFile(
      join(rootPath, ".blueprint", "blueprint-output.json"),
      "utf-8",
    )).resolves.toContain('"schemaVersion": "blueprint.v1"');
    await expect(readFile(
      join(rootPath, ".blueprint", "brief.md"),
      "utf-8",
    )).resolves.toContain("# Project Blueprint Brief");
    await expect(readFile(
      join(rootPath, ".blueprint", "groups", "runtime.md"),
      "utf-8",
    )).resolves.toContain("# Runtime");
    await expect(readFile(
      join(rootPath, ".blueprint", "groups", "docs.md"),
      "utf-8",
    )).resolves.toContain("# Documentation");
    for (const path of [
      [".blueprint", "blueprint-index.md"],
      [".blueprint", "blueprint-assistant-update.md"],
      [".blueprint", "blueprint-lint-report.md"],
      [".blueprint", "blueprint-log.md"],
      [".blueprint", "files", "src-index.md"],
      [".blueprint", "decisions", "README.md"],
      [".blueprint", "tasks", "README.md"],
      [".blueprint", "pitfalls", "README.md"],
      [".blueprint", "archive", "README.md"],
    ]) {
      await expect(readFile(join(rootPath, ...path), "utf-8")).rejects.toThrow();
    }
  });

  it("writes Markdown vision templates for groups", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-vision-"));
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId),
      "grouping",
    );

    await createComposeTool().handle({ groupingArtifactId }, store);

    const groupNote = await readFile(
      join(rootPath, ".blueprint", "groups", "runtime.md"),
      "utf-8",
    );

    expect(groupNote).toContain("---");
    expect(groupNote).toContain("id: group-runtime");
    expect(groupNote).toContain("type: group-note");
    expect(groupNote).toContain("groupId: runtime");
    expect(groupNote).toContain("source: llm-authored");
    expect(groupNote).toContain("# Runtime");
    for (const section of [
      "Snapshot",
      "Responsibilities",
      "Core Flow",
      "Contracts & Invariants",
      "Key Files",
      "Change Guide",
      "Pitfalls",
      "Tests",
      "Debugging",
      "Extension / Open Questions",
    ]) {
      expect(groupNote).toContain(`## ${section}`);
    }
    expect(groupNote).toContain(
      "TODO: Give the coding agent a fast orientation in 3-6 lines.",
    );
    expect(groupNote).toContain(
      "TODO: Tell the agent what must be updated together when this group changes.",
    );
    expect(groupNote).not.toContain("src/index.ts");
    expect(groupNote).not.toContain("file_index");
  });

  it("preserves existing Markdown vision notes instead of overwriting them", async () => {
    const store = new ArtifactStore();
    const rootPath = await mkdtemp(join(tmpdir(), "blueprint-compose-preserve-"));
    await mkdir(join(rootPath, ".blueprint", "groups"), { recursive: true });
    await writeFile(
      join(rootPath, ".blueprint", "groups", "runtime.md"),
      "# Runtime\n\nExisting group vision.\n",
      "utf-8",
    );
    await writeFile(
      join(rootPath, ".blueprint", "groups", "docs.md"),
      "# Documentation\n\nExisting docs vision.\n",
      "utf-8",
    );
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(rootPath),
      "inventory",
    );
    const groupingArtifactId = store.put(
      "groupingResult",
      createGroupingResult(inventoryArtifactId),
      "grouping",
    );

    const response = parseJsonToolResult<ComposeResponse>(
      await createComposeTool().handle({ groupingArtifactId }, store),
    );

    await expect(readFile(
      join(rootPath, ".blueprint", "groups", "runtime.md"),
      "utf-8",
    )).resolves.toBe("# Runtime\n\nExisting group vision.\n");
    expect(response.assistantNextSteps[0]).toMatchObject({
      kind: "hydrate-group-docs",
      required: false,
      executionPolicy: "optional",
      reason: "group-docs-current",
      targets: [
        expect.objectContaining({ groupId: "docs", status: "current" }),
        expect.objectContaining({ groupId: "runtime", status: "current" }),
      ],
    });
  });

  it("keeps compose valid when grouping has warnings but no blocking issues", async () => {
    const store = new ArtifactStore();
    const groupingArtifactId = store.put(
      "groupingResult",
      {
        ...createGroupingResult(),
        validation: {
          ...createGroupingResult().validation,
          isComplete: true,
          isAssignedCompletely: true,
          hasWarnings: true,
          blockingIssues: [],
          warningIssues: ["unknownPatterns"],
          unknownPatterns: [
            {
              pattern: "missing/**",
              reason: "matched no inventory files",
              suggestions: [],
            },
          ],
        },
      } satisfies GroupingResult,
      "grouping",
    );

    const response = parseJsonToolResult<ComposeResponse>(
      await createComposeTool().handle({ groupingArtifactId }, store),
    );

    expect(response.validation).toEqual({
      isValid: true,
      groupingComplete: true,
      groupingIssueSummary: [],
      groupingWarningSummary: ["unknownPatterns"],
    });
    expect(response.output.validation.groupingIssueSummary).toEqual([]);
    expect(response.output.validation.groupingWarningSummary).toEqual(["unknownPatterns"]);
  });
});
