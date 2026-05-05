import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileId, sha256 } from "../../src/lib/hashing.js";
import { type BlueprintOutput } from "../../src/tools/compose/compose.types.js";
import { GroupUpdateTool } from "../../src/tools/group-update/index.js";
import { GroupUpdateApplier } from "../../src/tools/group-update/group-update-applier.js";
import { type BlueprintReviewDecision } from "../../src/tools/group-update/group-update.types.js";
import { GroupUpdateValidator } from "../../src/tools/group-update/group-update-validator.js";
import {
  RefreshTool,
} from "../../src/tools/refresh/index.js";
import { type ScannedBlueprintFile } from "../../src/tools/refresh/refresh.types.js";
import { parseJsonToolResult } from "../../src/types.js";

const unassignedGroupId = "__unassigned__";

interface RefreshHandleResponse {
  summary: string;
  maintenancePrompt: string;
  refresh: {
    added: Array<{ fileId: string; path: string }>;
    updated: Array<{ fileId: string; path: string; groupId: string }>;
    deleted: Array<{ fileId: string; path: string; groupId: string }>;
    unassignedFiles: Array<{ fileId: string; path: string }>;
    emptyGroupCandidates: Array<{ groupId: string }>;
    affectedGroups: string[];
  };
  written: {
    blueprintOutputPath: string;
    refreshScanPath: string;
  };
  assistantNextSteps: {
    required: boolean;
    prompt: string;
    tools: string[];
  };
}

let tempRoot: string;
let refreshTool: RefreshTool;
let groupUpdateValidator: GroupUpdateValidator;
let groupUpdateApplier: GroupUpdateApplier;
let groupUpdateTool: GroupUpdateTool;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "blueprint-refresh-"));
  refreshTool = new RefreshTool();
  groupUpdateValidator = new GroupUpdateValidator();
  groupUpdateApplier = new GroupUpdateApplier(groupUpdateValidator);
  groupUpdateTool = new GroupUpdateTool(groupUpdateValidator, groupUpdateApplier);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function createBlueprintOutput(): BlueprintOutput {
  return {
    schemaVersion: "blueprint.v1",
    project: {
      analysisArtifactId: "analysis_old",
      inventoryArtifactId: "inventory_old",
      summary: "Fixture Blueprint project.",
    },
    groups: [
      {
        id: "runtime",
        name: "Runtime",
        summary: "Runs the application and exposes public entrypoints.",
        docsPath: "blueprint/groups/runtime.md",
        fileIds: ["file_app", "file_router"],
      },
      {
        id: "legacy",
        name: "Legacy Tools",
        summary: "Contains old compatibility tools.",
        docsPath: "blueprint/groups/legacy.md",
        fileIds: ["file_legacy"],
      },
      {
        id: "tests",
        name: "Tests",
        summary: "Covers runtime and refresh behavior.",
        docsPath: "blueprint/groups/tests.md",
        fileIds: ["file_app_test"],
      },
    ],
    files: [
      {
        id: "file_app",
        path: "src/app.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        notesStatus: "not-required",
      },
      {
        id: "file_router",
        path: "src/router.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        notesStatus: "not-required",
      },
      {
        id: "file_legacy",
        path: "src/legacy/old-tool.ts",
        groupId: "legacy",
        category: "source",
        language: "typescript",
        notesStatus: "not-required",
      },
      {
        id: "file_app_test",
        path: "tests/app.test.ts",
        groupId: "tests",
        category: "test",
        language: "typescript",
        notesStatus: "not-required",
      },
    ],
    edges: [
      {
        fromGroupId: "runtime",
        toGroupId: "legacy",
        type: "imports",
        count: 1,
      },
      {
        fromGroupId: "tests",
        toGroupId: "runtime",
        type: "tests",
        count: 1,
      },
    ],
    fileEdges: [
      {
        fromFileId: "file_app",
        toFileId: "file_router",
        fromPath: "src/app.ts",
        toPath: "src/router.ts",
        type: "imports",
        symbols: ["createRouter"],
      },
      {
        fromFileId: "file_app",
        toFileId: "file_legacy",
        fromPath: "src/app.ts",
        toPath: "src/legacy/old-tool.ts",
        type: "imports",
        symbols: ["runOldTool"],
      },
      {
        fromFileId: "file_app_test",
        toFileId: "file_app",
        fromPath: "tests/app.test.ts",
        toPath: "src/app.ts",
        type: "imports",
        symbols: ["startApp"],
      },
    ],
    symbols: [
      {
        id: "symbol_start_app",
        fileId: "file_app",
        path: "src/app.ts",
        name: "startApp",
        kind: "function",
        signature: "startApp(): void",
        startLine: 1,
        endLine: 5,
        exported: true,
      },
      {
        id: "symbol_create_router",
        fileId: "file_router",
        path: "src/router.ts",
        name: "createRouter",
        kind: "function",
        signature: "createRouter(): Router",
        startLine: 1,
        endLine: 5,
        exported: true,
      },
      {
        id: "symbol_run_old_tool",
        fileId: "file_legacy",
        path: "src/legacy/old-tool.ts",
        name: "runOldTool",
        kind: "function",
        signature: "runOldTool(): void",
        startLine: 1,
        endLine: 5,
        exported: true,
      },
    ],
    entrypoints: [
      {
        kind: "mcp-tool",
        name: "runtime.start",
        handler: "startApp",
        path: "src/app.ts",
        registrationPath: "src/index.ts",
      },
      {
        kind: "mcp-tool",
        name: "legacy.run",
        handler: "runOldTool",
        path: "src/legacy/old-tool.ts",
        registrationPath: "src/index.ts",
      },
    ],
    testLinks: [
      {
        sourceFileId: "file_app",
        sourcePath: "src/app.ts",
        testFileId: "file_app_test",
        testPath: "tests/app.test.ts",
        confidence: 0.95,
        reasons: ["imports-source", "name-match"],
      },
      {
        sourceFileId: "file_legacy",
        sourcePath: "src/legacy/old-tool.ts",
        testFileId: "file_app_test",
        testPath: "tests/app.test.ts",
        confidence: 0.8,
        reasons: ["imports-source"],
      },
    ],
    validation: {
      isValid: true,
      groupingComplete: true,
      groupingIssueSummary: [],
      groupingWarningSummary: [],
    },
  };
}

function scannedFile(
  id: string,
  path: string,
  hash: string,
  overrides: Partial<ScannedBlueprintFile> = {},
): ScannedBlueprintFile {
  return {
    id,
    path,
    hash,
    category: path.includes("test") ? "test" : "source",
    language: path.endsWith(".md") ? "markdown" : "typescript",
    sizeBytes: 100,
    ...overrides,
  };
}

function baselineScan(): ScannedBlueprintFile[] {
  return [
    scannedFile("file_app", "src/app.ts", "hash_app_v1"),
    scannedFile("file_router", "src/router.ts", "hash_router_v1"),
    scannedFile("file_legacy", "src/legacy/old-tool.ts", "hash_legacy_v1"),
    scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
  ];
}

async function writeRefreshHandleFixture(root: string): Promise<void> {
  await mkdir(join(root, "src", "legacy"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await mkdir(join(root, "blueprint"), { recursive: true });

  const appV2 = "export const app = 'v2';\n";
  const router = "export const router = true;\n";
  const newTool = "export const newTool = true;\n";
  const appTest = "import '../src/app.js';\n";

  await writeFile(join(root, "src", "app.ts"), appV2, "utf-8");
  await writeFile(join(root, "src", "router.ts"), router, "utf-8");
  await writeFile(join(root, "src", "new-tool.ts"), newTool, "utf-8");
  await writeFile(join(root, "tests", "app.test.ts"), appTest, "utf-8");

  const previousScan = [
    scannedFile("file_app", "src/app.ts", inventoryHash("export const app = 'v1';\n")),
    scannedFile("file_router", "src/router.ts", inventoryHash(router)),
    scannedFile("file_legacy", "src/legacy/old-tool.ts", inventoryHash("export const legacy = true;\n")),
    scannedFile("file_app_test", "tests/app.test.ts", inventoryHash(appTest)),
  ];

  await writeFile(
    join(root, "blueprint", "blueprint-output.json"),
    JSON.stringify(createBlueprintOutput(), null, 2),
    "utf-8",
  );
  await writeFile(
    join(root, "blueprint", "refresh-scan.json"),
    JSON.stringify(previousScan, null, 2),
    "utf-8",
  );
}

function inventoryHash(content: string): string {
  return sha256(Buffer.from(content).toString("base64"));
}

describe("RefreshTool handle", () => {
  it("refreshes Blueprint files from filesystem snapshots and returns the maintenance prompt without raw git diffs", async () => {
    await writeRefreshHandleFixture(tempRoot);

    const result = parseJsonToolResult<RefreshHandleResponse>(
      await refreshTool.handle({ projectRoot: tempRoot }),
    );

    expect(result.refresh.updated).toEqual([
      expect.objectContaining({
        fileId: "file_app",
        path: "src/app.ts",
        groupId: "runtime",
      }),
    ]);
    expect(result.refresh.deleted).toEqual([
      expect.objectContaining({
        fileId: "file_legacy",
        path: "src/legacy/old-tool.ts",
        groupId: "legacy",
      }),
    ]);
    expect(result.refresh.added).toEqual([
      expect.objectContaining({
        fileId: fileId("src/new-tool.ts"),
        path: "src/new-tool.ts",
      }),
    ]);
    expect(result.refresh.unassignedFiles).toEqual([
      expect.objectContaining({
        fileId: fileId("src/new-tool.ts"),
        path: "src/new-tool.ts",
      }),
    ]);
    expect(result.assistantNextSteps).toEqual({
      required: true,
      prompt: result.maintenancePrompt,
      tools: ["blueprint.group.update"],
    });
    expect(result.maintenancePrompt).toContain("Blueprint JSON was refreshed deterministically.");
    expect(result.maintenancePrompt).toContain("Files waiting for assignment:");
    expect(result.maintenancePrompt).not.toContain("diff --git");
    expect(result.maintenancePrompt).not.toContain("rawDiff");
    expect(result.written).toEqual({
      blueprintOutputPath: "blueprint/blueprint-output.json",
      refreshScanPath: "blueprint/refresh-scan.json",
    });

    const output = JSON.parse(
      await readFile(join(tempRoot, "blueprint", "blueprint-output.json"), "utf-8"),
    ) as BlueprintOutput;
    expect(output.files.find((file) => file.path === "src/new-tool.ts")?.groupId).toBe(unassignedGroupId);
    expect(output.files.map((file) => file.path)).not.toContain("src/legacy/old-tool.ts");

    const refreshScan = JSON.parse(
      await readFile(join(tempRoot, "blueprint", "refresh-scan.json"), "utf-8"),
    ) as ScannedBlueprintFile[];
    expect(refreshScan.map((file) => file.path)).toContain("src/new-tool.ts");
    expect(refreshScan.map((file) => file.path)).not.toContain("blueprint/blueprint-output.json");
  });

  it("supports dryRun without writing refreshed Blueprint files", async () => {
    await writeRefreshHandleFixture(tempRoot);
    const beforeOutput = await readFile(join(tempRoot, "blueprint", "blueprint-output.json"), "utf-8");
    const beforeScan = await readFile(join(tempRoot, "blueprint", "refresh-scan.json"), "utf-8");

    const result = parseJsonToolResult<RefreshHandleResponse>(
      await refreshTool.handle({ projectRoot: tempRoot, dryRun: true }),
    );

    expect(result.refresh.unassignedFiles.map((file) => file.path)).toEqual(["src/new-tool.ts"]);
    expect(result.written).toEqual({
      blueprintOutputPath: "",
      refreshScanPath: "",
    });
    await expect(readFile(join(tempRoot, "blueprint", "blueprint-output.json"), "utf-8"))
      .resolves.toBe(beforeOutput);
    await expect(readFile(join(tempRoot, "blueprint", "refresh-scan.json"), "utf-8"))
      .resolves.toBe(beforeScan);
  });
});

describe("RefreshTool buildPlan", () => {
  it("classifies unchanged, updated, added, deleted, and ignored generated files", () => {
    const previous = createBlueprintOutput();
    const current = [
      scannedFile("file_app", "src/app.ts", "hash_app_v2"),
      scannedFile("file_router", "src/router.ts", "hash_router_v1"),
      scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
      scannedFile("file_generated", "blueprint/blueprint-output.json", "hash_generated"),
      scannedFile("file_cache", ".cache/blueprint.json", "hash_cache"),
    ];

    const plan = refreshTool.buildPlan(previous, baselineScan(), current);

    expect(plan.updated).toEqual([
      {
        fileId: "file_app",
        path: "src/app.ts",
        groupId: "runtime",
        previousHash: "hash_app_v1",
        currentHash: "hash_app_v2",
      },
    ]);
    expect(plan.added).toEqual([
      {
        fileId: "file_refresh",
        path: "src/tools/refresh/index.ts",
        category: "source",
        language: "typescript",
        hash: "hash_refresh_v1",
      },
    ]);
    expect(plan.deleted).toEqual([
      {
        fileId: "file_legacy",
        path: "src/legacy/old-tool.ts",
        groupId: "legacy",
        previousHash: "hash_legacy_v1",
      },
    ]);
    expect(plan.unchanged.map((file) => file.path)).toEqual([
      "src/router.ts",
      "tests/app.test.ts",
    ]);
    expect(plan.ignored.map((file) => file.path)).toEqual([
      "blueprint/blueprint-output.json",
      ".cache/blueprint.json",
    ]);
    expect(plan.emptyGroupCandidates).toEqual([
      {
        groupId: "legacy",
        name: "Legacy Tools",
        docsPath: "blueprint/groups/legacy.md",
        deletedFileIds: ["file_legacy"],
      },
    ]);
  });

  it("uses explicit changed paths as an update signal when no previous hash snapshot exists", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(
      previous,
      [],
      baselineScan(),
      ["src/app.ts"],
    );

    expect(plan.updated).toEqual([
      {
        fileId: "file_app",
        path: "src/app.ts",
        groupId: "runtime",
        previousHash: "",
        currentHash: "hash_app_v1",
      },
    ]);
    expect(plan.unchanged.map((file) => file.path)).toEqual([
      "src/router.ts",
      "src/legacy/old-tool.ts",
      "tests/app.test.ts",
    ]);
  });
});

describe("RefreshTool apply", () => {
  it("removes deleted files from every Blueprint reference without asking the LLM", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      scannedFile("file_app", "src/app.ts", "hash_app_v1"),
      scannedFile("file_router", "src/router.ts", "hash_router_v1"),
      scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
    ]);

    const result = refreshTool.apply(previous, plan);

    expect(result.output.files.map((file) => file.id)).not.toContain("file_legacy");
    expect(result.output.groups.find((group) => group.id === "legacy")?.fileIds).toEqual([]);
    expect(result.output.fileEdges).toEqual([
      expect.objectContaining({
        fromFileId: "file_app",
        toFileId: "file_router",
      }),
      expect.objectContaining({
        fromFileId: "file_app_test",
        toFileId: "file_app",
      }),
    ]);
    expect(result.output.symbols.map((symbol) => symbol.fileId)).not.toContain("file_legacy");
    expect(result.output.entrypoints.map((entrypoint) => entrypoint.path)).not.toContain(
      "src/legacy/old-tool.ts",
    );
    expect(result.output.testLinks.map((link) => link.sourceFileId)).not.toContain("file_legacy");
    expect(result.emptyGroupCandidates).toEqual([
      expect.objectContaining({ groupId: "legacy" }),
    ]);
  });

  it("adds new files as unassigned records and preserves existing group assignments", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      ...baselineScan(),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
    ]);

    const result = refreshTool.apply(previous, plan);

    expect(result.output.files).toContainEqual({
      id: "file_refresh",
      path: "src/tools/refresh/index.ts",
      groupId: unassignedGroupId,
      category: "source",
      language: "typescript",
      notesStatus: "not-required",
    });
    expect(result.unassignedFiles).toEqual([
      {
        fileId: "file_refresh",
        path: "src/tools/refresh/index.ts",
        category: "source",
        language: "typescript",
      },
    ]);
    expect(result.output.groups.find((group) => group.id === "runtime")?.fileIds).toEqual([
      "file_app",
      "file_router",
    ]);
  });

  it("keeps previously unresolved unassigned files in refresh review state", () => {
    const previous = createBlueprintOutput();
    previous.files.push({
      id: "file_page",
      path: "src/pages/blueprint-refresh-page.tsx",
      groupId: unassignedGroupId,
      category: "source",
      language: "tsx",
      notesStatus: "not-required",
    });
    const scan = [
      ...baselineScan(),
      scannedFile("file_page", "src/pages/blueprint-refresh-page.tsx", "hash_page_v1", {
        language: "tsx",
      }),
    ];
    const plan = refreshTool.buildPlan(previous, scan, scan);

    const result = refreshTool.apply(previous, plan);

    expect(result.addedFiles).toEqual([]);
    expect(result.updatedFiles).toEqual([]);
    expect(result.unassignedFiles).toEqual([
      {
        fileId: "file_page",
        path: "src/pages/blueprint-refresh-page.tsx",
        category: "source",
        language: "tsx",
      },
    ]);
  });

  it("removes deleted files even when they were still unassigned", () => {
    const previous = createBlueprintOutput();
    previous.files.push({
      id: "file_page",
      path: "src/pages/blueprint-refresh-page.tsx",
      groupId: unassignedGroupId,
      category: "source",
      language: "tsx",
      notesStatus: "not-required",
    });
    const previousScan = [
      ...baselineScan(),
      scannedFile("file_page", "src/pages/blueprint-refresh-page.tsx", "hash_page_v1", {
        language: "tsx",
      }),
    ];
    const plan = refreshTool.buildPlan(previous, previousScan, baselineScan());

    const result = refreshTool.apply(previous, plan);

    expect(plan.deleted).toContainEqual({
      fileId: "file_page",
      path: "src/pages/blueprint-refresh-page.tsx",
      groupId: unassignedGroupId,
      previousHash: "hash_page_v1",
    });
    expect(result.output.files.map((file) => file.id)).not.toContain("file_page");
    expect(result.deletedFiles.map((file) => file.fileId)).toContain("file_page");
    expect(result.unassignedFiles.map((file) => file.fileId)).not.toContain("file_page");
  });

  it("refreshes updated file metadata without changing its group assignment", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      scannedFile("file_app", "src/app.ts", "hash_app_v2", {
        sizeBytes: 250,
        language: "typescript",
        category: "source",
      }),
      scannedFile("file_router", "src/router.ts", "hash_router_v1"),
      scannedFile("file_legacy", "src/legacy/old-tool.ts", "hash_legacy_v1"),
      scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
    ]);

    const result = refreshTool.apply(previous, plan);

    expect(result.updatedFiles).toEqual([
      expect.objectContaining({
        fileId: "file_app",
        path: "src/app.ts",
        groupId: "runtime",
      }),
    ]);
    expect(result.output.files.find((file) => file.id === "file_app")).toEqual(
      expect.objectContaining({
        id: "file_app",
        path: "src/app.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
      }),
    );
  });
});

describe("GroupUpdateValidator", () => {
  it("accepts assignments, new groups, and empty group deletions that match the refresh packet", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      scannedFile("file_app", "src/app.ts", "hash_app_v1"),
      scannedFile("file_router", "src/router.ts", "hash_router_v1"),
      scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
      scannedFile("file_worker", "src/worker.ts", "hash_worker_v1"),
    ]);
    const refreshed = refreshTool.apply(previous, plan);
    const decision: BlueprintReviewDecision = {
      assignments: [
        {
          fileId: "file_refresh",
          groupId: "runtime",
        },
      ],
      newGroups: [
        {
          id: "worker-runtime",
          name: "Worker Runtime",
          summary: "Owns background worker execution.",
          fileIds: ["file_worker"],
        },
      ],
      deleteGroups: ["legacy"],
    };

    expect(groupUpdateValidator.validate(refreshed.output, refreshed, decision)).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it("rejects invalid LLM decisions with precise, user-readable errors", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      ...baselineScan(),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
    ]);
    const refreshed = refreshTool.apply(previous, plan);
    const decision: BlueprintReviewDecision = {
      assignments: [
        {
          fileId: "file_app",
          groupId: "runtime",
        },
        {
          fileId: "file_refresh",
          groupId: "missing-group",
        },
        {
          fileId: "file_refresh",
          groupId: "tests",
        },
      ],
      newGroups: [
        {
          id: "runtime",
          name: "Runtime Duplicate",
          summary: "Should be rejected because the id already exists.",
          fileIds: ["file_refresh"],
        },
        {
          id: "invalid-files",
          name: "Invalid Files",
          summary: "Should be rejected because it references an existing assigned file.",
          fileIds: ["file_router"],
        },
      ],
      deleteGroups: ["runtime"],
    };

    expect(groupUpdateValidator.validate(refreshed.output, refreshed, decision)).toEqual({
      isValid: false,
      errors: [
        "assignments[0].fileId file_app is not an unassigned new file",
        "assignments[1].groupId missing-group does not exist",
        "fileId file_refresh is assigned more than once",
        "newGroups[0].id runtime already exists",
        "newGroups[1].fileIds[0] file_router is not an unassigned new file",
        "deleteGroups[0] runtime is not empty",
      ],
    });
  });
});

describe("GroupUpdateApplier", () => {
  it("assigns new files to existing groups and creates new groups with deterministic docsPath", async () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      ...baselineScan(),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
      scannedFile("file_worker", "src/worker.ts", "hash_worker_v1"),
    ]);
    const refreshed = refreshTool.apply(previous, plan);
    const decision: BlueprintReviewDecision = {
      assignments: [
        {
          fileId: "file_refresh",
          groupId: "runtime",
        },
      ],
      newGroups: [
        {
          id: "worker-runtime",
          name: "Worker Runtime",
          summary: "Owns background worker execution.",
          fileIds: ["file_worker"],
        },
      ],
      deleteGroups: [],
    };

    const result = await groupUpdateApplier.apply(refreshed.output, refreshed, decision, {
      projectRoot: tempRoot,
    });

    expect(result.output.files.find((file) => file.id === "file_refresh")?.groupId).toBe(
      "runtime",
    );
    expect(result.output.groups.find((group) => group.id === "runtime")?.fileIds).toContain(
      "file_refresh",
    );
    expect(result.output.groups).toContainEqual({
      id: "worker-runtime",
      name: "Worker Runtime",
      summary: "Owns background worker execution.",
      docsPath: "blueprint/groups/worker-runtime.md",
      fileIds: ["file_worker"],
    });
    expect(result.output.files.find((file) => file.id === "file_worker")?.groupId).toBe(
      "worker-runtime",
    );
    expect(result.createdGroupDocs).toEqual(["blueprint/groups/worker-runtime.md"]);
    const createdGroupDoc = await readFile(
      join(tempRoot, "blueprint/groups/worker-runtime.md"),
      "utf-8",
    );
    expect(createdGroupDoc).toContain("groupId: worker-runtime");
    expect(createdGroupDoc).toContain(
      "Writing style: keep sections compact, evidence-based, and useful for both frontend cards and coding agents.",
    );
    expect(createdGroupDoc).toContain(
      "TODO: Give the coding agent a fast orientation in 3-6 lines.",
    );
    expect(createdGroupDoc).toContain(
      "TODO: Tell the agent what must be updated together when this group changes.",
    );
  });

  it("deletes empty groups and removes their markdown according to the simple first policy", async () => {
    await mkdir(join(tempRoot, "blueprint/groups"), { recursive: true });
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      scannedFile("file_app", "src/app.ts", "hash_app_v1"),
      scannedFile("file_router", "src/router.ts", "hash_router_v1"),
      scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
    ]);
    const refreshed = refreshTool.apply(previous, plan);
    const decision: BlueprintReviewDecision = {
      assignments: [],
      newGroups: [],
      deleteGroups: ["legacy"],
    };

    const result = await groupUpdateApplier.apply(refreshed.output, refreshed, decision, {
      projectRoot: tempRoot,
    });

    expect(result.output.groups.map((group) => group.id)).not.toContain("legacy");
    expect(result.deletedGroups).toEqual(["legacy"]);
    expect(result.deletedGroupDocs).toEqual(["blueprint/groups/legacy.md"]);
    expect(result.output.edges).toEqual([
      {
        fromGroupId: "tests",
        toGroupId: "runtime",
        type: "tests",
        count: 1,
      },
    ]);
  });
});

describe("RefreshTool formatSummary", () => {
  it("prints a compact readable summary for the frontend and logs", () => {
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      scannedFile("file_app", "src/app.ts", "hash_app_v2"),
      scannedFile("file_router", "src/router.ts", "hash_router_v1"),
      scannedFile("file_app_test", "tests/app.test.ts", "hash_test_v1"),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
    ]);
    const refreshed = refreshTool.apply(previous, plan);

    expect(refreshTool.formatSummary(refreshed)).toBe([
      "Blueprint refresh summary",
      "- added: 1 (src/tools/refresh/index.ts)",
      "- updated: 1 (src/app.ts -> runtime)",
      "- deleted: 1 (src/legacy/old-tool.ts -> legacy)",
      "- unassigned: 1 (src/tools/refresh/index.ts)",
      "- empty groups: 1 (legacy)",
      "- affected groups: legacy, runtime",
    ].join("\n"));
  });
});

describe("GroupUpdateTool", () => {
  it("applies LLM group decisions to blueprint-output.json and returns a compact result", async () => {
    await mkdir(join(tempRoot, "blueprint", "groups"), { recursive: true });
    const previous = createBlueprintOutput();
    const plan = refreshTool.buildPlan(previous, baselineScan(), [
      ...baselineScan(),
      scannedFile("file_refresh", "src/tools/refresh/index.ts", "hash_refresh_v1"),
      scannedFile("file_worker", "src/worker.ts", "hash_worker_v1"),
    ]);
    const refreshed = refreshTool.apply(previous, plan);
    await writeFile(
      join(tempRoot, "blueprint", "blueprint-output.json"),
      JSON.stringify(refreshed.output, null, 2),
      "utf-8",
    );

    const response = parseJsonToolResult<{
      applied: boolean;
      validation: { isValid: boolean; errors: string[] };
      assignedFiles: Array<{ fileId: string; path: string; groupId: string }>;
      createdGroups: Array<{ id: string; docsPath: string; fileIds: string[] }>;
      deletedGroups: string[];
      createdGroupDocs: string[];
      deletedGroupDocs: string[];
      written: { blueprintOutputPath: string; briefPath: string };
    }>(await groupUpdateTool.handle({
      projectRoot: tempRoot,
      decision: {
        assignments: [
          {
            fileId: "file_refresh",
            groupId: "runtime",
          },
        ],
        newGroups: [
          {
            id: "worker-runtime",
            name: "Worker Runtime",
            summary: "Owns background worker execution.",
            fileIds: ["file_worker"],
          },
        ],
        deleteGroups: [],
      },
    }));

    expect(response).toEqual({
      applied: true,
      validation: { isValid: true, errors: [] },
      assignedFiles: [
        {
          fileId: "file_refresh",
          path: "src/tools/refresh/index.ts",
          groupId: "runtime",
        },
        {
          fileId: "file_worker",
          path: "src/worker.ts",
          groupId: "worker-runtime",
        },
      ],
      createdGroups: [
        {
          id: "worker-runtime",
          docsPath: "blueprint/groups/worker-runtime.md",
          fileIds: ["file_worker"],
        },
      ],
      deletedGroups: [],
      createdGroupDocs: ["blueprint/groups/worker-runtime.md"],
      deletedGroupDocs: [],
      written: {
        blueprintOutputPath: "blueprint/blueprint-output.json",
        briefPath: "blueprint/brief.md",
      },
    });

    const written = JSON.parse(
      await readFile(join(tempRoot, "blueprint", "blueprint-output.json"), "utf-8"),
    ) as BlueprintOutput;
    expect(written.files.find((file) => file.id === "file_refresh")?.groupId).toBe("runtime");
    expect(written.files.find((file) => file.id === "file_worker")?.groupId).toBe("worker-runtime");

    const brief = await readFile(join(tempRoot, "blueprint", "brief.md"), "utf-8");
    expect(brief).toContain("# Project Blueprint Brief");
    expect(brief).toContain("### Runtime");
    expect(brief).toContain("### Worker Runtime");
    expect(brief).toContain("- id: worker-runtime");
    expect(brief).toContain("- docs: `blueprint/groups/worker-runtime.md`");
  });

  it("rejects invalid decisions and does not rewrite blueprint-output.json", async () => {
    await mkdir(join(tempRoot, "blueprint"), { recursive: true });
    const previous = createBlueprintOutput();
    await writeFile(
      join(tempRoot, "blueprint", "blueprint-output.json"),
      JSON.stringify(previous, null, 2),
      "utf-8",
    );

    const response = parseJsonToolResult<{
      applied: boolean;
      validation: { isValid: boolean; errors: string[] };
    }>(await groupUpdateTool.handle({
      projectRoot: tempRoot,
      decision: {
        assignments: [
          {
            fileId: "file_app",
            groupId: "runtime",
          },
        ],
        newGroups: [],
        deleteGroups: [],
      },
    }));

    expect(response).toEqual({
      applied: false,
      validation: {
        isValid: false,
        errors: [
          "assignments[0].fileId file_app is not an unassigned new file",
        ],
      },
    });
    const written = JSON.parse(
      await readFile(join(tempRoot, "blueprint", "blueprint-output.json"), "utf-8"),
    ) as BlueprintOutput;
    expect(written).toEqual(previous);
  });
});
