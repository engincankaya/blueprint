import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { type BlueprintOutput } from "../../src/tools/compose/compose.types.js";
import { handleTaskContext } from "../../src/tools/task-context.js";
import { parseJsonToolResult } from "../../src/types.js";

interface TaskContextResponse {
  task: string;
  primaryFiles: Array<{
    id: string;
    path: string;
    score: number;
    why: string[];
  }>;
  secondaryFiles: Array<{
    path: string;
    why: string[];
  }>;
  relatedGroups: Array<{
    id: string;
    docsPath: string;
    why: string[];
  }>;
  relatedSymbols: Array<{
    name: string;
    path: string;
    why: string[];
  }>;
  relevantEdges: {
    fileEdges: BlueprintOutput["fileEdges"];
    groupEdges: BlueprintOutput["edges"];
  };
  likelyTests: Array<{
    path: string;
    why: string[];
  }>;
  docsToRead: Array<{
    path: string;
    reason: string;
  }>;
  watchOuts: Array<{
    code: string;
  }>;
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
        id: "auth",
        name: "Authentication",
        kind: "runtime",
        summary: "Owns login, session, and validation behavior.",
        docsPath: "blueprint/groups/auth.md",
        fileIds: ["file_login", "file_session"],
      },
      {
        id: "billing",
        name: "Billing",
        kind: "feature",
        summary: "Owns invoices and payment records.",
        docsPath: "blueprint/groups/billing.md",
        fileIds: ["file_invoice"],
      },
    ],
    files: [
      {
        id: "file_login",
        path: "src/auth/login.ts",
        groupId: "auth",
        category: "source",
        language: "typescript",
        docsPath: "blueprint/files/src-auth-login.md",
        notesStatus: "missing",
        summary: "Handles user login validation and credential checks.",
        role: "entrypoint",
      },
      {
        id: "file_session",
        path: "src/auth/session.ts",
        groupId: "auth",
        category: "source",
        language: "typescript",
        docsPath: "blueprint/files/src-auth-session.md",
        notesStatus: "missing",
        summary: "Stores authenticated user session state.",
        role: "model",
      },
      {
        id: "file_login_test",
        path: "tests/auth/login.test.ts",
        groupId: "auth",
        category: "test",
        language: "typescript",
        notesStatus: "not-required",
        summary: "Covers login validation behavior.",
        role: "test",
      },
      {
        id: "file_invoice",
        path: "src/billing/invoice.ts",
        groupId: "billing",
        category: "source",
        language: "typescript",
        docsPath: "blueprint/files/src-billing-invoice.md",
        notesStatus: "missing",
        summary: "Builds invoice records.",
        role: "model",
      },
    ],
    edges: [
      {
        fromGroupId: "auth",
        toGroupId: "billing",
        type: "references",
        count: 1,
      },
    ],
    fileEdges: [
      {
        fromFileId: "file_login",
        toFileId: "file_session",
        fromPath: "src/auth/login.ts",
        toPath: "src/auth/session.ts",
        type: "imports",
        symbols: ["createSession"],
      },
      {
        fromFileId: "file_invoice",
        toFileId: "file_login",
        fromPath: "src/billing/invoice.ts",
        toPath: "src/auth/login.ts",
        type: "imports",
        symbols: ["login"],
      },
    ],
    symbols: [
      {
        id: "symbol_login",
        fileId: "file_login",
        path: "src/auth/login.ts",
        name: "login",
        kind: "function",
        signature: "login(credentials: Credentials): Promise<User>",
        startLine: 10,
        endLine: 20,
        exported: true,
      },
      {
        id: "symbol_validate_login",
        fileId: "file_login",
        path: "src/auth/login.ts",
        name: "validateLogin",
        kind: "function",
        signature: "validateLogin(input: LoginInput): ValidationResult",
        startLine: 22,
        endLine: 32,
        exported: false,
      },
      {
        id: "symbol_create_session",
        fileId: "file_session",
        path: "src/auth/session.ts",
        name: "createSession",
        kind: "function",
        signature: "createSession(user: User): Session",
        startLine: 5,
        endLine: 12,
        exported: true,
      },
    ],
    entrypoints: [
      {
        kind: "mcp-tool",
        name: "auth.login",
        handler: "login",
        path: "src/auth/login.ts",
        registrationPath: "src/auth/index.ts",
      },
    ],
    testLinks: [
      {
        sourceFileId: "file_login",
        sourcePath: "src/auth/login.ts",
        testFileId: "file_login_test",
        testPath: "tests/auth/login.test.ts",
        confidence: 0.9,
        reasons: ["imports-source-file", "name-match"],
      },
    ],
    validation: {
      isValid: true,
      groupingComplete: true,
      documentationValid: true,
      groupingIssueSummary: [],
      groupingWarningSummary: [],
      missingGroupDocs: [],
      missingFileDocs: [],
      undocumentedSelectedGroupIds: [],
      undocumentedSelectedFileIds: [],
    },
  };
}

function createRoutingBlueprintOutput(): BlueprintOutput {
  const output = createBlueprintOutput();

  output.groups = [
    {
      id: "tooling",
      name: "Blueprint Tools",
      kind: "runtime",
      summary: "Exposes MCP tools that build and query Blueprint graph artifacts.",
      docsPath: "blueprint/groups/tooling.md",
      fileIds: [
        "file_index",
        "file_compose",
        "file_task_context",
        "file_group",
        "file_context",
        "file_old_find",
        "file_task_context_doc",
        "file_task_context_test",
      ],
    },
    {
      id: "project_support",
      name: "Project Support",
      kind: "other",
      summary: "Contains project scripts and package metadata.",
      docsPath: "blueprint/groups/project-support.md",
      fileIds: ["file_shebang"],
    },
  ];
  output.files = [
    {
      id: "file_index",
      path: "src/index.ts",
      groupId: "tooling",
      category: "source",
      language: "typescript",
      docsPath: "blueprint/files/src-index.md",
      notesStatus: "missing",
      summary: "Registers MCP tools with Zod input schemas.",
      role: "entrypoint",
    },
    {
      id: "file_compose",
      path: "src/tools/compose/index.ts",
      groupId: "tooling",
      category: "source",
      language: "typescript",
      docsPath: "blueprint/files/src-tools-compose.md",
      notesStatus: "missing",
      summary: "Composes Blueprint JSON and Markdown docs.",
      role: "tool",
    },
    {
      id: "file_task_context",
      path: "src/tools/task-context.ts",
      groupId: "tooling",
      category: "source",
      language: "typescript",
      docsPath: "blueprint/files/src-tools-task-context.md",
      notesStatus: "missing",
      summary: "Routes natural language tasks to relevant files, tests, and docs.",
      role: "tool",
    },
    {
      id: "file_group",
      path: "src/tools/group.ts",
      groupId: "tooling",
      category: "source",
      language: "typescript",
      docsPath: "blueprint/files/src-tools-group.md",
      notesStatus: "missing",
      summary: "Applies grouping plans.",
      role: "tool",
    },
    {
      id: "file_context",
      path: "src/tools/scan.ts",
      groupId: "tooling",
      category: "source",
      language: "typescript",
      docsPath: "blueprint/files/src-tools-context.md",
      notesStatus: "missing",
      summary: "Builds broad project context snapshots.",
      role: "tool",
    },
    {
      id: "file_old_find",
      path: "src/tools/group.ts",
      groupId: "tooling",
      category: "source",
      language: "typescript",
      docsPath: "blueprint/files/src-tools-old-find.md",
      notesStatus: "missing",
      summary: "Builds detailed find context for search results.",
      role: "tool",
    },
    {
      id: "file_task_context_doc",
      path: "blueprint/files/src-tools-task-context.md",
      groupId: "tooling",
      category: "documentation",
      language: "markdown",
      notesStatus: "not-required",
      summary: "Vision note for task context routing.",
      role: "documentation",
    },
    {
      id: "file_task_context_test",
      path: "tests/tools/task-context.test.ts",
      groupId: "tooling",
      category: "test",
      language: "typescript",
      notesStatus: "not-required",
      summary: "Covers task context routing and no primary files warnings.",
      role: "test",
    },
    {
      id: "file_shebang",
      path: "scripts/add-shebang.js",
      groupId: "project_support",
      category: "script",
      language: "javascript",
      notesStatus: "not-required",
      summary: "Adds a shebang to the built command file.",
      role: "script",
    },
  ];
  output.fileEdges = [
    {
      fromFileId: "file_index",
      toFileId: "file_task_context",
      fromPath: "src/index.ts",
      toPath: "src/tools/task-context.ts",
      type: "imports",
      symbols: ["handleTaskContext"],
    },
    {
      fromFileId: "file_index",
      toFileId: "file_compose",
      fromPath: "src/index.ts",
      toPath: "src/tools/compose/index.ts",
      type: "imports",
      symbols: ["ComposeTool"],
    },
    {
      fromFileId: "file_task_context",
      toFileId: "file_compose",
      fromPath: "src/tools/task-context.ts",
      toPath: "src/tools/compose/index.ts",
      type: "imports",
      symbols: ["BlueprintOutput"],
    },
    {
      fromFileId: "file_task_context_test",
      toFileId: "file_task_context",
      fromPath: "tests/tools/task-context.test.ts",
      toPath: "src/tools/task-context.ts",
      type: "imports",
      symbols: ["handleTaskContext"],
    },
  ];
  output.edges = [
    {
      fromGroupId: "tooling",
      toGroupId: "project_support",
      type: "references",
      count: 1,
    },
  ];
  output.symbols = [
    {
      id: "symbol_handle_task_context",
      fileId: "file_task_context",
      path: "src/tools/task-context.ts",
      name: "handleTaskContext",
      kind: "function",
      signature: "handleTaskContext(args: TaskContextArgs): Promise<ToolResult>",
      exported: true,
    },
    {
      id: "symbol_score_file",
      fileId: "file_task_context",
      path: "src/tools/task-context.ts",
      name: "scoreFile",
      kind: "function",
      signature: "scoreFile(file, taskTokens, symbols)",
      exported: false,
    },
    {
      id: "symbol_collect_tests",
      fileId: "file_task_context",
      path: "src/tools/task-context.ts",
      name: "collectLikelyTests",
      kind: "function",
      signature: "collectLikelyTests(primaryFiles, taskTokens)",
      exported: false,
    },
    {
      id: "symbol_blueprint_output",
      fileId: "file_compose",
      path: "src/tools/compose/index.ts",
      name: "BlueprintOutput",
      kind: "interface",
      signature: "interface BlueprintOutput",
      exported: true,
    },
    {
      id: "symbol_compose_docs",
      fileId: "file_compose",
      path: "src/tools/compose/index.ts",
      name: "composeAffectedDocs",
      kind: "function",
      signature: "composeAffectedDocs(blueprint, docs)",
      exported: false,
    },
    {
      id: "symbol_compose_schema",
      fileId: "file_compose",
      path: "src/tools/compose/index.ts",
      name: "composeSchemaChanges",
      kind: "function",
      signature: "composeSchemaChanges(blueprint)",
      exported: false,
    },
    {
      id: "symbol_compose_index",
      fileId: "file_compose",
      path: "src/tools/compose/index.ts",
      name: "renderBlueprintIndex",
      kind: "function",
      signature: "renderBlueprintIndex(blueprint)",
      exported: false,
    },
    {
      id: "symbol_group_input",
      fileId: "file_group",
      path: "src/tools/group.ts",
      name: "GroupToolInput",
      kind: "interface",
      signature: "interface GroupToolInput",
      exported: false,
    },
    {
      id: "symbol_server",
      fileId: "file_index",
      path: "src/index.ts",
      name: "server",
      kind: "variable",
      signature: "const server = new McpServer()",
      exported: false,
    },
    {
      id: "symbol_task_context_response",
      fileId: "file_task_context_test",
      path: "tests/tools/task-context.test.ts",
      name: "TaskContextResponse",
      kind: "interface",
      signature: "interface TaskContextResponse",
      exported: false,
    },
    {
      id: "symbol_context_args",
      fileId: "file_context",
      path: "src/tools/scan.ts",
      name: "ContextArgs",
      kind: "interface",
      signature: "interface ContextArgs",
      exported: false,
    },
    {
      id: "symbol_handle_context",
      fileId: "file_context",
      path: "src/tools/scan.ts",
      name: "handleScan",
      kind: "function",
      signature: "handleScan(args: ContextArgs): Promise<ToolResult>",
      exported: true,
    },
    {
      id: "symbol_find_context",
      fileId: "file_old_find",
      path: "src/tools/group.ts",
      name: "FindContext",
      kind: "interface",
      signature: "interface FindContext",
      exported: false,
    },
    {
      id: "symbol_build_find_context",
      fileId: "file_old_find",
      path: "src/tools/group.ts",
      name: "buildFindContext",
      kind: "function",
      signature: "buildFindContext(query: string): FindContext",
      exported: false,
    },
    {
      id: "symbol_shebang_content",
      fileId: "file_shebang",
      path: "scripts/add-shebang.js",
      name: "content",
      kind: "variable",
      signature: "const content = readFileSync(filePath)",
      exported: false,
    },
  ];
  output.entrypoints = [
    {
      kind: "mcp-tool",
      name: "blueprint.compose",
      handler: "ComposeTool",
      path: "src/tools/compose/index.ts",
      registrationPath: "src/index.ts",
    },
    {
      kind: "mcp-tool",
      name: "blueprint.group",
      handler: "handleGroup",
      path: "src/tools/group.ts",
      registrationPath: "src/index.ts",
    },
    {
      kind: "mcp-tool",
      name: "blueprint.scan",
      handler: "handleScan",
      path: "src/tools/scan.ts",
      registrationPath: "src/index.ts",
    },
    {
      kind: "mcp-tool",
      name: "blueprint.task_context",
      handler: "handleTaskContext",
      path: "src/tools/task-context.ts",
      registrationPath: "src/index.ts",
    },
  ];
  output.testLinks = [
    {
      sourceFileId: "file_task_context",
      sourcePath: "src/tools/task-context.ts",
      testFileId: "file_task_context_test",
      testPath: "tests/tools/task-context.test.ts",
      confidence: 0.95,
      reasons: ["imports-source", "name-match"],
    },
  ];
  return output;
}

describe("blueprint.task_context", () => {
  it("returns an error for a missing artifact", async () => {
    const result = await handleTaskContext(
      { blueprintArtifactId: "missing", task: "login validation" },
      new ArtifactStore(),
    );

    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "Blueprint artifact not found: missing",
    });
  });

  it("routes a task to deterministic files, docs, symbols, edges, and tests", async () => {
    const store = new ArtifactStore();
    const artifactId = store.put("blueprintOutput", createBlueprintOutput(), "blueprint");

    const response = parseJsonToolResult<TaskContextResponse>(
      await handleTaskContext(
        {
          blueprintArtifactId: artifactId,
          task: "update auth login validation behavior",
        },
        store,
      ),
    );

    expect(response.primaryFiles[0].path).toBe("src/auth/login.ts");
    expect(response.primaryFiles[0].why).toEqual(
      expect.arrayContaining([
        "path-token-match:auth,login",
        "group-token-match:behavior,login,validation",
        "entrypoint-match:auth.login:auth,login",
      ]),
    );
    expect([
      ...response.primaryFiles.map((file) => file.path),
      ...response.secondaryFiles.map((file) => file.path),
    ]).toEqual(
      expect.arrayContaining(["src/auth/session.ts", "src/billing/invoice.ts"]),
    );
    expect(response.relatedGroups).toContainEqual(
      expect.objectContaining({
        id: "auth",
        docsPath: "blueprint/groups/auth.md",
      }),
    );
    expect(response.relatedSymbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["login", "validateLogin"]),
    );
    expect(response.relevantEdges.fileEdges).toHaveLength(2);
    expect(response.relevantEdges.groupEdges).toHaveLength(1);
    expect(response.likelyTests).toContainEqual(
      expect.objectContaining({
        path: "tests/auth/login.test.ts",
        why: expect.arrayContaining(["test-link:src/auth/login.ts"]),
      }),
    );
    expect(response.docsToRead.map((doc) => doc.path)).toEqual(
      expect.arrayContaining([
        "blueprint/groups/auth.md",
        "blueprint/files/src-auth-login.md",
      ]),
    );
  });

  it("warns when no primary files match the task", async () => {
    const store = new ArtifactStore();
    const artifactId = store.put("blueprintOutput", createBlueprintOutput(), "blueprint");

    const response = parseJsonToolResult<TaskContextResponse>(
      await handleTaskContext(
        {
          blueprintArtifactId: artifactId,
          task: "render calendar month picker",
        },
        store,
      ),
    );

    expect(response.primaryFiles).toEqual([]);
    expect(response.watchOuts.map((watchOut) => watchOut.code)).toContain(
      "no-primary-files",
    );
  });

  it("keeps task-context ahead of compose for scoring-specific routing tasks", async () => {
    const store = new ArtifactStore();
    const artifactId = store.put("blueprintOutput", createRoutingBlueprintOutput(), "blueprint");

    const response = parseJsonToolResult<TaskContextResponse>(
      await handleTaskContext(
        {
          blueprintArtifactId: artifactId,
          task: "add scoring cap to blueprint task context so common tokens do not dominate routing",
        },
        store,
      ),
    );

    expect(response.primaryFiles[0].path).toBe("src/tools/task-context.ts");
    expect(response.primaryFiles.every((file) => file.category !== "test")).toBe(true);
    expect(response.secondaryFiles.every((file) => file.category !== "test")).toBe(true);
    expect(response.likelyTests.map((test) => test.path)).toContain(
      "tests/tools/task-context.test.ts",
    );
    expect(response.primaryFiles.map((file) => file.path)).not.toContain(
      "scripts/add-shebang.js",
    );
    expect(response.primaryFiles.map((file) => file.path)).not.toContain(
      "src/tools/scan.ts",
    );
    expect(response.primaryFiles.map((file) => file.path)).not.toContain(
      "src/tools/group.ts",
    );
    expect(response.primaryFiles.map((file) => file.path)).not.toContain(
      "blueprint/files/src-tools-task-context.md",
    );
    expect(response.relatedSymbols.map((symbol) => symbol.path)).not.toContain(
      "src/tools/group.ts",
    );
  });

  it("prioritizes the registration file for MCP tool registration tasks", async () => {
    const store = new ArtifactStore();
    const artifactId = store.put("blueprintOutput", createRoutingBlueprintOutput(), "blueprint");

    const response = parseJsonToolResult<TaskContextResponse>(
      await handleTaskContext(
        {
          blueprintArtifactId: artifactId,
          task: "register a new MCP tool in server index with zod input schema",
        },
        store,
      ),
    );

    expect(response.primaryFiles[0].path).toBe("src/index.ts");
    expect(response.primaryFiles[0].why).toContain(
      "entrypoint-registration-match:blueprint.task_context:mcp,tool",
    );
  });

  it("does not route unrelated tasks through incidental common-token symbol matches", async () => {
    const store = new ArtifactStore();
    const artifactId = store.put("blueprintOutput", createRoutingBlueprintOutput(), "blueprint");

    const response = parseJsonToolResult<TaskContextResponse>(
      await handleTaskContext(
        {
          blueprintArtifactId: artifactId,
          task: "implement offline calendar recurring event drag and drop UI with timezone conversion",
        },
        store,
      ),
    );

    expect(response.primaryFiles).toEqual([]);
    expect(response.relatedSymbols).toEqual([]);
    expect(response.watchOuts.map((watchOut) => watchOut.code)).toContain(
      "no-primary-files",
    );
  });
});
