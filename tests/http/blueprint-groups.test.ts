import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { BlueprintGroupService } from "../../src/services/blueprint-group-service.js";
import { initServices } from "../../src/services/init-services.js";
import {
  createApiRouter,
  handleBlueprintGroupDetailRequest,
  handleBlueprintGroupsRequest,
} from "../../src/server/routes/index.js";
import { type BlueprintOutput } from "../../src/tools/compose/compose.types.js";

function createRequest(method: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const request = Readable.from(chunks) as IncomingMessage;
  request.method = method;
  return request;
}

async function writeBlueprintFixture(
  output: BlueprintOutput = createBlueprintOutput(),
): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "blueprint-groups-"));
  await mkdir(join(projectRoot, "blueprint", "groups"), { recursive: true });
  await writeFile(
    join(projectRoot, "blueprint", "blueprint-output.json"),
    JSON.stringify(output, null, 2),
    "utf-8",
  );
  return projectRoot;
}

async function writeRuntimeGroupDoc(projectRoot: string): Promise<void> {
  await writeFile(
    join(projectRoot, "blueprint", "groups", "runtime.md"),
    [
      "---",
      "id: group-runtime",
      "type: group-note",
      "groupId: runtime",
      "status: ready",
      "lastReviewedAt: 2026-04-26T10:00:00.000Z",
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
      "## Core Flow",
      "Request -> handler.",
      "",
      "## Contracts & Invariants",
      "- Keep response JSON stable.",
      "",
      "## Key Files",
      "- `src/index.ts`: registration.",
      "",
      "## Change Guide",
      "Update tests with handlers.",
      "",
      "## Pitfalls",
      "Avoid stale docs.",
      "",
      "## Tests",
      "`tests/http/blueprint-groups.test.ts`.",
      "",
      "## Debugging",
      "Check response payload.",
      "",
      "## Extension / Open Questions",
      "None.",
      "",
    ].join("\n"),
    "utf-8",
  );
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
        summary: "Owns MCP registration and process startup.",
        docsPath: "blueprint/groups/runtime.md",
        fileIds: ["file_index", "file_types"],
      },
      {
        id: "services",
        name: "Services",
        kind: "runtime",
        summary: "Owns application services.",
        docsPath: "blueprint/groups/services.md",
        fileIds: ["file_service"],
      },
    ],
    files: [
      {
        id: "file_index",
        path: "src/index.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        notesStatus: "missing",
        summary: "Registers public MCP tools.",
        role: "entrypoint",
      },
      {
        id: "file_types",
        path: "src/types.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        notesStatus: "missing",
        summary: "Defines shared tool response helpers.",
        role: "contract",
      },
      {
        id: "file_service",
        path: "src/services/runtime-service.ts",
        groupId: "services",
        category: "source",
        language: "typescript",
        notesStatus: "not-required",
        summary: "Provides runtime service helpers.",
        role: "service",
      },
    ],
    edges: [
      {
        fromGroupId: "runtime",
        toGroupId: "services",
        type: "imports",
        count: 2,
      },
    ],
    fileEdges: [],
    symbols: [],
    entrypoints: [],
    testLinks: [],
    validation: {
      isValid: true,
      groupingComplete: true,
      documentationValid: true,
      groupingIssueSummary: [],
      groupingWarningSummary: ["docs are partial"],
      missingGroupDocs: ["services"],
      missingFileDocs: [],
      undocumentedSelectedGroupIds: [],
      undocumentedSelectedFileIds: [],
    },
  };
}

describe("blueprint group HTTP handlers", () => {
  it("does not route removed terminal chat endpoints", async () => {
    const router = createApiRouter(initServices({}));
    const projectRoot = await writeBlueprintFixture();

    await expect(
      router.dispatch(
        createRequest("POST", { prompt: "hello" }),
        new URL("http://local.request/api/terminal/query"),
        projectRoot,
      ),
    ).resolves.toBeUndefined();
    await expect(
      router.dispatch(
        createRequest("POST", { prompt: "hello" }),
        new URL("http://local.request/api/terminal/query/stream"),
        projectRoot,
      ),
    ).resolves.toBeUndefined();
  });

  it("returns a lightweight group overview with connections", async () => {
    const projectRoot = await writeBlueprintFixture();
    await writeRuntimeGroupDoc(projectRoot);

    const response = await handleBlueprintGroupsRequest(
      projectRoot,
      new BlueprintGroupService(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      schemaVersion: "blueprint.v1",
      groups: [
        {
          id: "runtime",
          name: "Runtime",
          kind: "runtime",
          summary: "Owns MCP registration and process startup.",
          fileCount: 2,
          docsStatus: "ready",
          connections: [
            {
              groupId: "services",
              groupName: "Services",
              direction: "outgoing",
              type: "imports",
              count: 2,
            },
          ],
        },
        {
          id: "services",
          name: "Services",
          kind: "runtime",
          summary: "Owns application services.",
          fileCount: 1,
          docsStatus: "missing",
          connections: [
            {
              groupId: "runtime",
              groupName: "Runtime",
              direction: "incoming",
              type: "imports",
              count: 2,
            },
          ],
        },
      ],
      totals: {
        groups: 2,
        files: 3,
        edges: 1,
      },
      validation: {
        isValid: true,
        warnings: ["docs are partial"],
      },
    });
  });

  it("returns group details, files, connections, and parsed doc sections", async () => {
    const projectRoot = await writeBlueprintFixture();
    await writeRuntimeGroupDoc(projectRoot);

    const response = await handleBlueprintGroupDetailRequest(
      projectRoot,
      "runtime",
      new BlueprintGroupService(),
    );
    const body = response.payload as {
      group: {
        id: string;
        name: string;
        docsPath: string;
        fileCount: number;
      };
      doc: {
        exists: boolean;
        frontmatter: Record<string, string>;
        sections: Record<string, string | undefined>;
        validation: { warnings: string[] };
      };
      files: Array<{ id: string; path: string; summary?: string; role?: string }>;
      connections: Array<{ groupId: string; direction: string; type: string; count: number }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.group).toMatchObject({
      id: "runtime",
      name: "Runtime",
      docsPath: "blueprint/groups/runtime.md",
      fileCount: 2,
    });
    expect(body.doc.exists).toBe(true);
    expect(body.doc.frontmatter).toMatchObject({
      groupId: "runtime",
      status: "ready",
    });
    expect(body.doc.sections).toMatchObject({
      snapshot: "Owns runtime startup.",
      responsibilities: "- Register tools.",
      coreFlow: "Request -> handler.",
      contractsAndInvariants: "- Keep response JSON stable.",
      keyFiles: "- `src/index.ts`: registration.",
      changeGuide: "Update tests with handlers.",
      pitfalls: "Avoid stale docs.",
      tests: "`tests/http/blueprint-groups.test.ts`.",
      debugging: "Check response payload.",
      extensionOpenQuestions: "None.",
    });
    expect(body.doc.validation.warnings).toEqual([]);
    expect(body.files).toEqual([
      {
        id: "file_index",
        path: "src/index.ts",
        category: "source",
        language: "typescript",
        summary: "Registers public MCP tools.",
        role: "entrypoint",
      },
      {
        id: "file_types",
        path: "src/types.ts",
        category: "source",
        language: "typescript",
        summary: "Defines shared tool response helpers.",
        role: "contract",
      },
    ]);
    expect(body.connections).toEqual([
      {
        groupId: "services",
        groupName: "Services",
        direction: "outgoing",
        type: "imports",
        count: 2,
      },
    ]);
  });

  it("returns doc.exists false when group markdown is missing", async () => {
    const projectRoot = await writeBlueprintFixture();

    const response = await handleBlueprintGroupDetailRequest(
      projectRoot,
      "services",
      new BlueprintGroupService(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      group: {
        id: "services",
        fileCount: 1,
      },
      doc: {
        exists: false,
        frontmatter: {},
        sections: {},
        validation: {
          warnings: ["group docs not found"],
        },
      },
    });
  });

  it("returns 404 when the group does not exist", async () => {
    const projectRoot = await writeBlueprintFixture();

    const response = await handleBlueprintGroupDetailRequest(
      projectRoot,
      "missing",
      new BlueprintGroupService(),
    );

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({
      error: "group not found",
      groupId: "missing",
    });
  });
});
