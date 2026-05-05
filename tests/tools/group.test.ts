import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { type AnalysisFacts } from "../../src/tools/scan/scan-code-analysis-engine.js";
import { type FileInventory } from "../../src/tools/scan/scan-file-inventory-builder.js";
import { parseJsonToolResult } from "../../src/types.js";
import { GroupTool } from "../../src/tools/group/index.js";
import { GroupingAssignmentEngine } from "../../src/tools/group/grouping-assignment-engine.js";
import { GroupingPlanValidator } from "../../src/tools/group/grouping-plan-validator.js";

function createGroupTool(): GroupTool {
  return new GroupTool(
    new GroupingPlanValidator(),
    new GroupingAssignmentEngine(),
  );
}

function createInventory(): FileInventory {
  return {
    rootPath: "/repo",
    options: {
      maxFiles: 10000,
      ignore: [],
      respectGitignore: true,
    },
    project: {
      name: "repo",
      rootPath: "/repo",
      detectedStack: ["typescript", "node"],
      packageManagers: ["npm"],
    },
    files: [
      {
        fileId: "file_index",
        path: "mcp-server/src/index.ts",
        absolutePath: "/repo/mcp-server/src/index.ts",
        language: "typescript",
        sizeBytes: 100,
        hash: "hash_index",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_analyze",
        path: "mcp-server/src/tools/analyze.ts",
        absolutePath: "/repo/mcp-server/src/tools/analyze.ts",
        language: "typescript",
        sizeBytes: 200,
        hash: "hash_analyze",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_frontend",
        path: "frontend/app.js",
        absolutePath: "/repo/frontend/app.js",
        language: "javascript",
        sizeBytes: 300,
        hash: "hash_frontend",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_readme",
        path: "README.md",
        absolutePath: "/repo/README.md",
        language: "markdown",
        sizeBytes: 50,
        hash: "hash_readme",
        category: "documentation",
        analysisLevel: "metadata-only",
        parseable: false,
      },
      {
        fileId: "file_plan",
        path: "docs/PLAN.md",
        absolutePath: "/repo/docs/PLAN.md",
        language: "markdown",
        sizeBytes: 60,
        hash: "hash_plan",
        category: "documentation",
        analysisLevel: "metadata-only",
        parseable: false,
      },
      {
        fileId: "file_old",
        path: "mcp-server/src/tools/scan.ts",
        absolutePath: "/repo/mcp-server/src/tools/scan.ts",
        language: "typescript",
        sizeBytes: 150,
        hash: "hash_old",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_lib",
        path: "mcp-server/src/lib/artifact-store.ts",
        absolutePath: "/repo/mcp-server/src/lib/artifact-store.ts",
        language: "typescript",
        sizeBytes: 180,
        hash: "hash_lib",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_types",
        path: "mcp-server/src/types.ts",
        absolutePath: "/repo/mcp-server/src/types.ts",
        language: "typescript",
        sizeBytes: 120,
        hash: "hash_types",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_parse",
        path: "mcp-server/src/tools/task-context.ts",
        absolutePath: "/repo/mcp-server/src/tools/task-context.ts",
        language: "typescript",
        sizeBytes: 130,
        hash: "hash_parse",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_resolve",
        path: "mcp-server/src/tools/refresh/index.ts",
        absolutePath: "/repo/mcp-server/src/tools/refresh/index.ts",
        language: "typescript",
        sizeBytes: 140,
        hash: "hash_resolve",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
    ],
    summary: {
      totalFiles: 10,
      parseableFiles: 8,
      metadataOnlyFiles: 2,
      truncated: false,
      languages: {
        javascript: 1,
        markdown: 2,
        typescript: 7,
      },
      categories: {
        source: 8,
        test: 0,
        config: 0,
        documentation: 2,
        asset: 0,
        lockfile: 0,
        generated: 0,
        script: 0,
        unknown: 0,
      },
      analysisLevels: {
        parseable: 8,
        "metadata-only": 2,
      },
      topLevelDirs: ["docs", "frontend", "mcp-server"],
    },
    validation: {
      isComplete: true,
      scannedFiles: 10,
      inventoriedFiles: 10,
      missingFiles: [],
      duplicatePaths: [],
      duplicateFileIds: [],
    },
  };
}

function createAnalysisFacts(inventoryArtifactId: string): AnalysisFacts {
  return {
    inventoryArtifactId,
    rootPath: "/repo",
    files: {
      file_index: {
        fileId: "file_index",
        path: "mcp-server/src/index.ts",
        language: "typescript",
        imports: ["./tools/analyze.js"],
        exports: [],
        symbols: [],
      },
      file_analyze: {
        fileId: "file_analyze",
        path: "mcp-server/src/tools/analyze.ts",
        language: "typescript",
        imports: [],
        exports: ["handleAnalyze"],
        symbols: ["sym_handleAnalyze"],
      },
      file_frontend: {
        fileId: "file_frontend",
        path: "frontend/app.js",
        language: "javascript",
        imports: [],
        exports: [],
        symbols: [],
      },
      file_old: {
        fileId: "file_old",
        path: "mcp-server/src/tools/scan.ts",
        language: "typescript",
        imports: ["../analyze.js"],
        exports: ["handleScan"],
        symbols: ["sym_handleScan"],
      },
      file_lib: {
        fileId: "file_lib",
        path: "mcp-server/src/lib/artifact-store.ts",
        language: "typescript",
        imports: [],
        exports: ["ArtifactStore"],
        symbols: ["sym_artifactStore"],
      },
      file_types: {
        fileId: "file_types",
        path: "mcp-server/src/types.ts",
        language: "typescript",
        imports: [],
        exports: ["ToolResult"],
        symbols: ["sym_toolResult"],
      },
      file_parse: {
        fileId: "file_parse",
        path: "mcp-server/src/tools/task-context.ts",
        language: "typescript",
        imports: ["../types.js"],
        exports: ["handleTaskContext"],
        symbols: ["sym_handleTaskContext"],
      },
      file_resolve: {
        fileId: "file_resolve",
        path: "mcp-server/src/tools/refresh/index.ts",
        language: "typescript",
        imports: ["../types.js"],
        exports: ["GroupUpdateTool"],
        symbols: ["sym_GroupUpdateTool"],
      },
    },
    symbols: {
      sym_handleAnalyze: {
        symbolId: "sym_handleAnalyze",
        fileId: "file_analyze",
        name: "handleAnalyze",
        kind: "function",
        visibility: "public",
        startLine: 10,
        endLine: 50,
      },
      sym_handleScan: {
        symbolId: "sym_handleScan",
        fileId: "file_old",
        name: "handleScan",
        kind: "function",
        visibility: "public",
        startLine: 20,
        endLine: 60,
      },
      sym_artifactStore: {
        symbolId: "sym_artifactStore",
        fileId: "file_lib",
        name: "ArtifactStore",
        kind: "class",
        visibility: "public",
        startLine: 5,
        endLine: 40,
      },
      sym_toolResult: {
        symbolId: "sym_toolResult",
        fileId: "file_types",
        name: "ToolResult",
        kind: "interface",
        visibility: "public",
        startLine: 1,
        endLine: 8,
      },
      sym_handleTaskContext: {
        symbolId: "sym_handleTaskContext",
        fileId: "file_parse",
        name: "handleTaskContext",
        kind: "function",
        visibility: "public",
        startLine: 1,
        endLine: 20,
      },
      sym_GroupUpdateTool: {
        symbolId: "sym_GroupUpdateTool",
        fileId: "file_resolve",
        name: "GroupUpdateTool",
        kind: "class",
        visibility: "public",
        startLine: 1,
        endLine: 20,
      },
    },
    imports: [
      {
        fileId: "file_index",
        rawSpecifier: "./tools/analyze.js",
        kind: "static",
        importedSymbols: ["handleAnalyze"],
      },
      {
        fileId: "file_old",
        rawSpecifier: "../analyze.js",
        kind: "static",
        importedSymbols: ["handleAnalyze"],
      },
      {
        fileId: "file_parse",
        rawSpecifier: "../types.js",
        kind: "static",
        importedSymbols: ["ToolResult"],
      },
      {
        fileId: "file_resolve",
        rawSpecifier: "../types.js",
        kind: "static",
        importedSymbols: ["ToolResult"],
      },
    ],
    exports: [
      {
        fileId: "file_analyze",
        kind: "named",
        exportedSymbols: ["handleAnalyze"],
      },
      {
        fileId: "file_old",
        kind: "named",
        exportedSymbols: ["handleScan"],
      },
      {
        fileId: "file_lib",
        kind: "named",
        exportedSymbols: ["ArtifactStore"],
      },
      {
        fileId: "file_types",
        kind: "named",
        exportedSymbols: ["ToolResult"],
      },
      {
        fileId: "file_parse",
        kind: "named",
        exportedSymbols: ["handleTaskContext"],
      },
      {
        fileId: "file_resolve",
        kind: "named",
        exportedSymbols: ["GroupUpdateTool"],
      },
    ],
    dependencies: [
      {
        fromFileId: "file_index",
        toFileId: "file_analyze",
        type: "imports",
        symbols: ["handleAnalyze"],
      },
      {
        fromFileId: "file_old",
        toFileId: "file_analyze",
        type: "imports",
        symbols: ["handleAnalyze"],
      },
      {
        fromFileId: "file_index",
        toFileId: "file_lib",
        type: "imports",
        symbols: ["ArtifactStore"],
      },
      {
        fromFileId: "file_index",
        toFileId: "file_types",
        type: "imports",
        symbols: ["ToolResult"],
      },
      {
        fromFileId: "file_analyze",
        toFileId: "file_types",
        type: "imports",
        symbols: ["ToolResult"],
      },
      {
        fromFileId: "file_parse",
        toFileId: "file_types",
        type: "imports",
        symbols: ["ToolResult"],
      },
      {
        fromFileId: "file_resolve",
        toFileId: "file_types",
        type: "imports",
        symbols: ["ToolResult"],
      },
    ],
    unresolvedImports: [],
    parseErrors: [],
    summary: {
      totalFiles: 10,
      parseableFiles: 8,
      metadataOnlyFiles: 2,
      plannedFiles: 8,
      parsedFiles: 8,
      symbols: 6,
      imports: 4,
      exports: 6,
      dependencies: 7,
      parseErrors: 0,
    },
    validation: {
      isComplete: true,
      inventoryFiles: 10,
      parseableFiles: 8,
      parsedFiles: 8,
      metadataOnlyFiles: 2,
      skippedMetadataOnlyFiles: 2,
      parseErrors: 0,
      unaccountedFiles: [],
    },
  };
}

interface PrepareResponse {
  mode: "prepare";
  validation: {
    isValid: boolean;
    estimatedTokens: number;
    maxEstimatedTokens: number;
    missingFields: string[];
    hasFullFileDump: boolean;
    folderSignals: number;
    importantFiles: number;
    dependencyHints: number;
  };
  packet: {
    project: {
      name: string;
      detectedStack: string[];
      packageManagers: string[];
      requiredPlanFields: string[];
    };
    constraints: {
      preferredGroupCount: string;
      maxGroupCount: number;
      eachFileExactlyOneGroup: boolean;
    };
    assignmentRules: {
      preferGlobPatterns: boolean;
      avoidListingEveryFile: boolean;
      globExamples: string[];
      exactPathUseCases: string[];
      requiredPlanFields: string[];
      fallbackStrategy: "folder-category";
      onlyUsePathsSeenInInventory: boolean;
      inventoryBoundaryNote: string;
      avoidPatternExamples: string[];
      guidancePrompt?: unknown;
    };
    inventorySummary: FileInventory["summary"];
    folderSignals: Array<{
      pattern: string;
      fileCount: number;
      categories: Record<string, number>;
      languages: Record<string, number>;
      topExports: string[];
      score: number;
    }>;
    importantFiles: Array<{
      fileId: string;
      path: string;
      exports: string[];
      symbolCount: number;
      incomingDependencies: number;
      outgoingDependencies: number;
    }>;
    dependencyHints: Array<{
      from: string;
      to: string;
      type: string;
      symbols: string[];
      incoming?: unknown;
      outgoing?: unknown;
      score?: unknown;
      why?: unknown;
      crossFolder?: unknown;
    }>;
    allFiles?: unknown;
    files?: unknown;
  };
  next: {
    prompt: "blueprint-create-grouping-plan";
    inputMap: {
      groupPreparePacketJson: "$.packet";
    };
    then: {
      tool: "blueprint.group";
      mode: "apply";
      analysisArtifactId: string;
    };
  };
}

interface ApplyResponse {
  mode: "apply";
  artifactId: string;
  summary: {
    groups: number;
    files: number;
    crossGroupEdges: number;
    internalDependencyEdges: number;
  };
  validation: {
    isComplete: boolean;
    isAssignedCompletely: boolean;
    hasWarnings: boolean;
    blockingIssues: string[];
    warningIssues: string[];
    inventoryFiles: number;
    assignedFiles: number;
    unassignedFiles: Array<{
      fileId: string;
      path: string;
      category: string;
      language: string;
    }>;
    duplicateAssignments: Array<{ fileId: string; path: string; groupIds: string[] }>;
    emptyGroups: string[];
    unknownPatterns: Array<{
      pattern: string;
      reason: string;
      suggestions: string[];
    }>;
    fallbackAssignments: Array<{
      fileId: string;
      path: string;
      category: string;
      language: string;
      fallbackGroupId: string;
    }>;
  };
  next: {
    tool: "blueprint.compose";
    input: {
      groupingArtifactId: string;
    };
  };
}

describe("blueprint.group prepare", () => {
  it("returns a clear error when the analysis artifact is missing", async () => {
    const store = new ArtifactStore();

    const result = await createGroupTool().handle({
      mode: "prepare",
      analysisArtifactId: "missing",
    }, store);

    expect(() => parseJsonToolResult<PrepareResponse>(result)).toThrow(
      "Analysis artifact missing not found",
    );
  });

  it("returns a clear error when the analysis artifact type is wrong", async () => {
    const store = new ArtifactStore();
    const artifactId = store.put("fileInventory", createInventory(), "wrong type");

    const result = await createGroupTool().handle({
      mode: "prepare",
      analysisArtifactId: artifactId,
    }, store);

    expect(() => parseJsonToolResult<PrepareResponse>(result)).toThrow(
      `Analysis artifact ${artifactId} not found or has the wrong type`,
    );
  });

  it("builds a compact LLM grouping packet with explicit glob guidance", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<PrepareResponse>(
      await createGroupTool().handle({ mode: "prepare", analysisArtifactId }, store),
    );

    expect(response.mode).toBe("prepare");
    expect(response.validation).toEqual({
      isValid: true,
      estimatedTokens: expect.any(Number),
      maxEstimatedTokens: 6000,
      missingFields: [],
      hasFullFileDump: false,
      folderSignals: expect.any(Number),
      importantFiles: 7,
      dependencyHints: 5,
    });
    expect(response.validation.estimatedTokens).toBeGreaterThan(0);
    expect(response.validation.estimatedTokens).toBeLessThanOrEqual(6000);
    expect(response.packet.project).toEqual({
      name: "repo",
      detectedStack: ["typescript", "node"],
      packageManagers: ["npm"],
      requiredPlanFields: ["project.summary", "groups[].id", "groups[].name", "groups[].include"],
    });
    expect(response.packet.constraints).toEqual({
      preferredGroupCount: "5-8",
      maxGroupCount: 12,
      eachFileExactlyOneGroup: true,
    });
    expect(response.packet.assignmentRules).toMatchObject({
      preferGlobPatterns: true,
      avoidListingEveryFile: true,
      exactPathUseCases: ["entrypoints", "exceptions", "cross-cutting-files"],
      requiredPlanFields: ["project.summary", "groups[].id", "groups[].name", "groups[].include"],
      fallbackStrategy: "folder-category",
      onlyUsePathsSeenInInventory: true,
      inventoryBoundaryNote: expect.stringContaining("inventory"),
      avoidPatternExamples: expect.arrayContaining(["node_modules/**", "*.json"]),
    });
    expect(response.packet.assignmentRules.guidancePrompt).toBeUndefined();
    expect(response.packet.assignmentRules.globExamples).toEqual(
      expect.arrayContaining(["docs/**", "frontend/**", "mcp-server/**"]),
    );
    const assignmentRulesJson = JSON.stringify(response.packet.assignmentRules);
    expect(assignmentRulesJson).not.toContain("Folder names are hints");
    expect(assignmentRulesJson).not.toContain("Do not enumerate files");
    expect(assignmentRulesJson).not.toContain("Return only a compact GroupingPlan");
    expect(assignmentRulesJson.length).toBeLessThan(500);
    expect(response.next.prompt).toBe("blueprint-create-grouping-plan");
    expect(response.next.inputMap).toEqual({
      groupPreparePacketJson: "$.packet",
    });
    expect(response.next.then).toEqual({
      tool: "blueprint.group",
      mode: "apply",
      analysisArtifactId,
    });
    expect(response.packet.allFiles).toBeUndefined();
    expect(response.packet.files).toBeUndefined();
    expect(response.packet.folderSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: "frontend/**",
          fileCount: 1,
        }),
        expect.objectContaining({
          pattern: "mcp-server/**",
          fileCount: 7,
          topExports: expect.arrayContaining(["handleAnalyze", "ArtifactStore"]),
        }),
        expect.objectContaining({
          pattern: "mcp-server/src/tools/**",
          fileCount: 4,
          topExports: expect.arrayContaining(["handleAnalyze", "handleScan"]),
          score: expect.any(Number),
        }),
        expect.objectContaining({
          pattern: "mcp-server/src/lib/**",
          fileCount: 1,
          topExports: ["ArtifactStore"],
          score: expect.any(Number),
        }),
      ]),
    );
    expect(response.packet.importantFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "file_analyze",
          path: "mcp-server/src/tools/analyze.ts",
          exports: ["handleAnalyze"],
          incomingDependencies: 2,
        }),
      ]),
    );
    expect(response.packet.dependencyHints).toEqual(
      expect.arrayContaining([
        {
          from: "mcp-server/src/index.ts",
          to: "mcp-server/src/tools/analyze.ts",
          type: "imports",
          symbols: ["handleAnalyze"],
        },
        {
          from: "mcp-server/src/tools/refresh/index.ts",
          to: "mcp-server/src/types.ts",
          type: "imports",
          symbols: ["ToolResult"],
        },
      ]),
    );
    for (const hint of response.packet.dependencyHints) {
      expect(hint.incoming).toBeUndefined();
      expect(hint.outgoing).toBeUndefined();
      expect(hint.score).toBeUndefined();
      expect(hint.why).toBeUndefined();
      expect(hint.crossFolder).toBeUndefined();
    }

    const folderPairCounts = new Map<string, number>();
    for (const hint of response.packet.dependencyHints) {
      const fromFolder = hint.from.split("/").slice(0, -1).join("/");
      const toFolder = hint.to.split("/").slice(0, -1).join("/");
      const key = `${fromFolder}->${toFolder}`;
      folderPairCounts.set(key, (folderPairCounts.get(key) ?? 0) + 1);
    }
    expect(Math.max(...folderPairCounts.values())).toBeLessThanOrEqual(2);
    const typesHints = response.packet.dependencyHints.filter(
      (hint) => hint.to === "mcp-server/src/types.ts",
    );
    expect(typesHints.length).toBeLessThanOrEqual(2);
  });

  it("includes inventory boundary guidance to discourage ignored or unseen path patterns", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<PrepareResponse>(
      await createGroupTool().handle({ mode: "prepare", analysisArtifactId }, store),
    );

    expect(response.packet.assignmentRules.onlyUsePathsSeenInInventory).toBe(true);
    expect(response.packet.assignmentRules.inventoryBoundaryNote).toContain("Only use paths present in the inventory packet.");
    expect(response.packet.assignmentRules.avoidPatternExamples).toEqual(
      expect.arrayContaining(["node_modules/**", "*.json"]),
    );
  });

  it("surfaces newly added tool files even when shared hubs are noisy", async () => {
    const store = new ArtifactStore();
    const inventory = createInventory();
    const inventoryArtifactId = store.put("fileInventory", inventory, "inventory");
    const facts = createAnalysisFacts(inventoryArtifactId);

    facts.files.file_compose = {
      fileId: "file_compose",
      path: "mcp-server/src/tools/compose/index.ts",
      language: "typescript",
      imports: [],
      exports: ["ComposeTool"],
      symbols: ["sym_ComposeTool"],
    };
    facts.files.file_task_context = {
      fileId: "file_task_context",
      path: "mcp-server/src/tools/task-context.ts",
      language: "typescript",
      imports: [],
      exports: ["handleTaskContext"],
      symbols: ["sym_handleTaskContext"],
    };
    facts.symbols.sym_ComposeTool = {
      symbolId: "sym_ComposeTool",
      fileId: "file_compose",
      name: "ComposeTool",
      kind: "class",
      visibility: "public",
      startLine: 1,
      endLine: 20,
    };
    facts.symbols.sym_handleTaskContext = {
      symbolId: "sym_handleTaskContext",
      fileId: "file_task_context",
      name: "handleTaskContext",
      kind: "function",
      visibility: "public",
      startLine: 1,
      endLine: 20,
    };

    for (let index = 0; index < 25; index += 1) {
      const fileId = `file_helper_${index}`;
      const importerId = `file_helper_importer_${index}`;
      const symbolId = `sym_helper_${index}`;
      facts.files[fileId] = {
        fileId,
        path: `mcp-server/src/lib/helper-${index}.ts`,
        language: "typescript",
        imports: [],
        exports: [`Helper${index}`],
        symbols: [symbolId],
      };
      facts.files[importerId] = {
        fileId: importerId,
        path: `mcp-server/src/lib/importer-${index}.ts`,
        language: "typescript",
        imports: [`./helper-${index}.js`],
        exports: [],
        symbols: [],
      };
      facts.symbols[symbolId] = {
        symbolId,
        fileId,
        name: `Helper${index}`,
        kind: "class",
        visibility: "public",
        startLine: 1,
        endLine: 10,
      };
      facts.dependencies.push({
        fromFileId: importerId,
        toFileId: fileId,
        type: "imports",
        symbols: [`Helper${index}`],
      });
    }

    const analysisArtifactId = store.put("analysisFacts", facts, "analysis");
    const response = parseJsonToolResult<PrepareResponse>(
      await createGroupTool().handle({ mode: "prepare", analysisArtifactId }, store),
    );

    expect(response.packet.importantFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "mcp-server/src/tools/compose/index.ts",
        "mcp-server/src/tools/task-context.ts",
      ]),
    );
    expect(response.packet.importantFiles.length).toBeLessThanOrEqual(20);
  });
});

describe("blueprint.group apply", () => {
  it("validates and stores deterministic groups from an LLM grouping plan", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<ApplyResponse>(
      await createGroupTool().handle({
        mode: "apply",
        analysisArtifactId,
        plan: {
          groups: [
            {
              id: "server",
              name: "Server Runtime",
              description: "MCP server code",
              kind: "runtime",
              include: ["mcp-server/**"],
              exclude: ["mcp-server/src/tools/analyze.ts"],
              confidence: 0.9,
            },
            {
              id: "analysis",
              name: "Analysis Pipeline",
              include: ["mcp-server/src/tools/analyze.ts"],
            },
            {
              id: "frontend",
              name: "Frontend",
              include: ["frontend/**"],
            },
          ],
          fallback: {
            strategy: "folder-category",
          },
        },
      }, store),
    );

    expect(response.mode).toBe("apply");
    expect(response.summary).toEqual({
      groups: 4,
      files: 10,
      crossGroupEdges: 2,
      internalDependencyEdges: 1,
    });
    expect(response.validation).toEqual({
      isComplete: true,
      isAssignedCompletely: true,
      hasWarnings: true,
      blockingIssues: [],
      warningIssues: ["fallbackAssignments"],
      inventoryFiles: 10,
      assignedFiles: 10,
      unassignedFiles: [],
      duplicateAssignments: [],
      emptyGroups: [],
      unknownPatterns: [],
      fallbackAssignments: [
        {
          fileId: "file_readme",
          path: "README.md",
          category: "documentation",
          language: "markdown",
          fallbackGroupId: "fallback-documentation",
        },
        {
          fileId: "file_plan",
          path: "docs/PLAN.md",
          category: "documentation",
          language: "markdown",
          fallbackGroupId: "fallback-documentation",
        },
      ],
    });
    expect(response.next).toEqual({
      tool: "blueprint.compose",
      input: {
        groupingArtifactId: response.artifactId,
      },
    });

    const artifact = store.getTyped<{
      groups: Array<{ id: string; files: Array<{ path: string }> }>;
      crossGroupEdges: Array<{ fromGroupId: string; toGroupId: string; count: number }>;
      internalDependencyEdges: Array<{ fromGroupId: string; toGroupId: string; count: number }>;
    }>(response.artifactId, "groupingResult");

    expect(artifact?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "server",
          files: expect.arrayContaining([
            {
              path: "mcp-server/src/index.ts",
              fileId: "file_index",
              category: "source",
              language: "typescript",
              importance: "unknown",
              role: "unknown",
            },
            {
              path: "mcp-server/src/lib/artifact-store.ts",
              fileId: "file_lib",
              category: "source",
              language: "typescript",
              importance: "unknown",
              role: "unknown",
            },
            {
              path: "mcp-server/src/tools/scan.ts",
              fileId: "file_old",
              category: "source",
              language: "typescript",
              importance: "unknown",
              role: "unknown",
            },
          ]),
        }),
        expect.objectContaining({
          id: "analysis",
          files: [{
            path: "mcp-server/src/tools/analyze.ts",
            fileId: "file_analyze",
            category: "source",
            language: "typescript",
            importance: "unknown",
            role: "unknown",
          }],
        }),
        expect.objectContaining({
          id: "frontend",
          files: [{
            path: "frontend/app.js",
            fileId: "file_frontend",
            category: "source",
            language: "javascript",
            importance: "unknown",
            role: "unknown",
          }],
        }),
        expect.objectContaining({
          id: "fallback-documentation",
          files: expect.arrayContaining([
            {
              path: "README.md",
              fileId: "file_readme",
              category: "documentation",
              language: "markdown",
              importance: "unknown",
              role: "unknown",
            },
            {
              path: "docs/PLAN.md",
              fileId: "file_plan",
              category: "documentation",
              language: "markdown",
              importance: "unknown",
              role: "unknown",
            },
          ]),
        }),
      ]),
    );
    expect(artifact?.crossGroupEdges).toEqual([
      { fromGroupId: "analysis", toGroupId: "server", type: "imports", count: 1 },
      { fromGroupId: "server", toGroupId: "analysis", type: "imports", count: 2 },
    ]);
    expect(artifact?.internalDependencyEdges).toEqual([
      { fromGroupId: "server", toGroupId: "server", type: "imports", count: 4 },
    ]);
  });

  it("reports invalid grouping plans before applying them", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const result = await createGroupTool().handle({
      mode: "apply",
      analysisArtifactId,
      plan: {
        groups: [
          { id: "server", name: "Server", include: ["mcp-server/**"] },
          { id: "server", name: "Duplicate Server", include: [] },
        ],
      },
    }, store);

    expect(() => parseJsonToolResult<ApplyResponse>(result)).toThrow(
      "Invalid GroupingPlan",
    );
  });

  it("accepts a JSON-stringified grouping plan in apply mode", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<ApplyResponse>(
      await createGroupTool().handle({
        mode: "apply",
        analysisArtifactId,
        plan: JSON.stringify({
          groups: [
            { id: "server", name: "Server", include: ["mcp-server/**"] },
            { id: "frontend", name: "Frontend", include: ["frontend/**"] },
          ],
          fallback: { strategy: "folder-category" },
        }),
      }, store),
    );

    expect(response.mode).toBe("apply");
    expect(response.validation.inventoryFiles).toBe(10);
    expect(response.validation.assignedFiles).toBe(10);
  });

  it("returns a clear error for malformed JSON-stringified grouping plans", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const result = await createGroupTool().handle({
      mode: "apply",
      analysisArtifactId,
      plan: "{\"groups\":[",
    }, store);

    expect(() => parseJsonToolResult<ApplyResponse>(result)).toThrow(
      "Invalid GroupingPlan: plan must be valid JSON when provided as a string",
    );
  });

  it("returns a clear error for empty-string grouping plans", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const result = await createGroupTool().handle({
      mode: "apply",
      analysisArtifactId,
      plan: "   ",
    }, store);

    expect(() => parseJsonToolResult<ApplyResponse>(result)).toThrow(
      "Invalid GroupingPlan: plan must be valid JSON when provided as a string",
    );
  });

  it("reports duplicate assignments and unknown patterns in validation", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<ApplyResponse>(
      await createGroupTool().handle({
        mode: "apply",
        analysisArtifactId,
        plan: {
          groups: [
            { id: "server", name: "Server", include: ["mcp-server/**"] },
            {
              id: "analysis",
              name: "Analysis",
              include: ["mcp-server/src/tools/**", "missing/**"],
            },
          ],
          fallback: { strategy: "folder-category" },
        },
      }, store),
    );

    expect(response.validation.isComplete).toBe(false);
    expect(response.validation.isAssignedCompletely).toBe(false);
    expect(response.validation.hasWarnings).toBe(true);
    expect(response.validation.blockingIssues).toEqual(["duplicateAssignments"]);
    expect(response.validation.warningIssues).toEqual([
      "unknownPatterns",
      "emptyGroups",
      "fallbackAssignments",
    ]);
    expect(response.validation.duplicateAssignments).toEqual([
      {
        fileId: "file_analyze",
        path: "mcp-server/src/tools/analyze.ts",
        category: "source",
        language: "typescript",
        groupIds: ["server", "analysis"],
      },
      {
        fileId: "file_old",
        path: "mcp-server/src/tools/scan.ts",
        category: "source",
        language: "typescript",
        groupIds: ["server", "analysis"],
      },
      {
        fileId: "file_parse",
        path: "mcp-server/src/tools/task-context.ts",
        category: "source",
        language: "typescript",
        groupIds: ["server", "analysis"],
      },
      {
        fileId: "file_resolve",
        path: "mcp-server/src/tools/refresh/index.ts",
        category: "source",
        language: "typescript",
        groupIds: ["server", "analysis"],
      },
    ]);
    expect(response.validation.unknownPatterns).toEqual([
      {
        pattern: "missing/**",
        reason: "matched no inventory files; the path may be ignored or not inventoried",
        suggestions: [],
      },
    ]);
    expect(response.validation.fallbackAssignments).toEqual(
      expect.arrayContaining([
        {
          fileId: "file_frontend",
          path: "frontend/app.js",
          category: "source",
          language: "javascript",
          fallbackGroupId: "fallback-source",
        },
        {
          fileId: "file_readme",
          path: "README.md",
          category: "documentation",
          language: "markdown",
          fallbackGroupId: "fallback-documentation",
        },
      ]),
    );
  });

  it("keeps grouping complete when all files are assigned but some patterns match nothing", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<ApplyResponse>(
      await createGroupTool().handle({
        mode: "apply",
        analysisArtifactId,
        plan: {
          groups: [
            { id: "server", name: "Server", include: ["mcp-server/**", "missing/**"] },
            { id: "frontend", name: "Frontend", include: ["frontend/**"] },
            { id: "docs", name: "Docs", include: ["*.md", "docs/**"] },
          ],
          fallback: { strategy: "folder-category" },
        },
      }, store),
    );

    expect(response.validation.isComplete).toBe(true);
    expect(response.validation.isAssignedCompletely).toBe(true);
    expect(response.validation.hasWarnings).toBe(true);
    expect(response.validation.blockingIssues).toEqual([]);
    expect(response.validation.warningIssues).toEqual(["unknownPatterns"]);
    expect(response.validation.unknownPatterns).toEqual([
      {
        pattern: "missing/**",
        reason: "matched no inventory files; the path may be ignored or not inventoried",
        suggestions: [],
      },
    ]);
  });

  it("reports fallback-assigned source files without making complete grouping invalid", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<ApplyResponse>(
      await createGroupTool().handle({
        mode: "apply",
        analysisArtifactId,
        plan: {
          groups: [
            { id: "docs", name: "Docs", include: ["*.md", "docs/**"] },
          ],
          fallback: { strategy: "folder-category" },
        },
      }, store),
    );

    expect(response.validation.isComplete).toBe(true);
    expect(response.validation.fallbackAssignments).toEqual(
      expect.arrayContaining([
        {
          fileId: "file_index",
          path: "mcp-server/src/index.ts",
          category: "source",
          language: "typescript",
          fallbackGroupId: "fallback-source",
        },
        {
          fileId: "file_frontend",
          path: "frontend/app.js",
          category: "source",
          language: "javascript",
          fallbackGroupId: "fallback-source",
        },
      ]),
    );
  });

  it("supports common glob patterns and reports unassigned files with paths", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      createInventory(),
      "inventory",
    );
    const analysisArtifactId = store.put(
      "analysisFacts",
      createAnalysisFacts(inventoryArtifactId),
      "analysis",
    );

    const response = parseJsonToolResult<ApplyResponse>(
      await createGroupTool().handle({
        mode: "apply",
        analysisArtifactId,
        plan: {
          groups: [
            { id: "root-docs", name: "Root Docs", include: ["*.md"] },
            { id: "all-docs", name: "All Docs", include: ["**/*.md"] },
            { id: "docs-folder", name: "Docs Folder", include: ["docs/**/*.md"] },
            {
              id: "exact-entry",
              name: "Exact Entry",
              include: ["frontend/app.js"],
            },
          ],
        },
      }, store),
    );

    expect(response.validation.unknownPatterns).toEqual([]);
    expect(response.validation.duplicateAssignments).toEqual([
      {
        fileId: "file_readme",
        path: "README.md",
        category: "documentation",
        language: "markdown",
        groupIds: ["root-docs", "all-docs"],
      },
      {
        fileId: "file_plan",
        path: "docs/PLAN.md",
        category: "documentation",
        language: "markdown",
        groupIds: ["all-docs", "docs-folder"],
      },
    ]);
    expect(response.validation.unassignedFiles).toEqual(
      expect.arrayContaining([
        {
          fileId: "file_index",
          path: "mcp-server/src/index.ts",
          category: "source",
          language: "typescript",
        },
        {
          fileId: "file_analyze",
          path: "mcp-server/src/tools/analyze.ts",
          category: "source",
          language: "typescript",
        },
      ]),
    );
  });
});
