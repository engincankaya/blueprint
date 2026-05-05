import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { parseJsonToolResult } from "../../src/types.js";
import { CodeAnalysisEngine } from "../../src/tools/scan/scan-code-analysis-engine.js";
import { type FileInventory } from "../../src/tools/scan/scan-file-inventory-builder.js";

function createCodeAnalysisEngine(): CodeAnalysisEngine {
  return new CodeAnalysisEngine();
}

async function createInventoryFixture(): Promise<FileInventory> {
  const rootPath = await mkdtemp(join(tmpdir(), "blueprint-analyze-"));
  await mkdir(join(rootPath, "src"), { recursive: true });
  await writeFile(
    join(rootPath, "src", "helper.ts"),
    "export function helper() { return 42; }\n",
    "utf-8",
  );
  await writeFile(
    join(rootPath, "src", "index.ts"),
    [
      "import { helper } from './helper.js';",
      "export interface User { id: string }",
      "export function run(user: User) { return helper() + user.id.length; }",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(join(rootPath, "README.md"), "# Fixture\n", "utf-8");

  return {
    rootPath,
    options: {
      maxFiles: 10000,
      ignore: [],
      respectGitignore: true,
    },
    project: {
      name: "repo",
      rootPath,
      detectedStack: ["typescript"],
      packageManagers: ["npm"],
    },
    files: [
      {
        fileId: "file_source",
        path: "src/index.ts",
        absolutePath: join(rootPath, "src", "index.ts"),
        language: "typescript",
        sizeBytes: 25,
        hash: "hash_source",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_helper",
        path: "src/helper.ts",
        absolutePath: join(rootPath, "src", "helper.ts"),
        language: "typescript",
        sizeBytes: 38,
        hash: "hash_helper",
        category: "source",
        analysisLevel: "parseable",
        parseable: true,
      },
      {
        fileId: "file_readme",
        path: "README.md",
        absolutePath: join(rootPath, "README.md"),
        language: "markdown",
        sizeBytes: 9,
        hash: "hash_readme",
        category: "documentation",
        analysisLevel: "metadata-only",
        parseable: false,
      },
    ],
    summary: {
      totalFiles: 3,
      parseableFiles: 2,
      metadataOnlyFiles: 1,
      truncated: false,
      languages: {
        markdown: 1,
        typescript: 2,
      },
      categories: {
        source: 2,
        test: 0,
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
  };
}

interface AnalyzeResponse {
  artifactId: string;
  summary: {
    totalFiles: number;
    parsedFiles: number;
    parseErrors: number;
  };
  next: {
    tool: string;
    input: {
      analysisArtifactId: string;
    };
  };
  validationStatus: {
    isComplete: boolean;
  };
  validation?: unknown;
  files?: unknown;
}

describe("CodeAnalysisEngine", () => {
  it("returns a clear error when the inventory artifact is missing", async () => {
    const store = new ArtifactStore();

    const result = await createCodeAnalysisEngine().handle({
      inventoryArtifactId: "missing",
    }, store);

    expect(() => parseJsonToolResult<AnalyzeResponse>(result)).toThrow(
      "File inventory artifact missing not found",
    );
  });

  it("returns a clear error when the artifact type is wrong", async () => {
    const store = new ArtifactStore();
    const wrongArtifactId = store.put("blueprintOutput", {}, "wrong type");

    const result = await createCodeAnalysisEngine().handle({
      inventoryArtifactId: wrongArtifactId,
    }, store);

    expect(() => parseJsonToolResult<AnalyzeResponse>(result)).toThrow(
      `File inventory artifact ${wrongArtifactId} not found or has the wrong type`,
    );
  });

  it("reads fileInventory and stores an analysis facts artifact", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      await createInventoryFixture(),
      "fixture inventory",
    );

    const response = parseJsonToolResult<AnalyzeResponse>(
      await createCodeAnalysisEngine().handle({ inventoryArtifactId }, store),
    );

    expect(response.files).toBeUndefined();
    expect(response.summary).toEqual({
      totalFiles: 3,
      parsedFiles: 2,
      parseErrors: 0,
    });
    expect(response.next).toEqual({
      tool: "blueprint.group",
      input: {
        analysisArtifactId: response.artifactId,
      },
    });
    expect(response.validationStatus).toEqual({
      isComplete: true,
    });
    expect(response.validation).toBeUndefined();

    const artifact = store.get(response.artifactId);
    const facts = artifact?.data as {
      summary: {
        totalFiles: number;
        parseableFiles: number;
        metadataOnlyFiles: number;
        plannedFiles: number;
        parsedFiles: number;
        symbols: number;
        imports: number;
        exports: number;
        dependencies: number;
        parseErrors: number;
      };
      validation: {
        isComplete: boolean;
        inventoryFiles: number;
        parseableFiles: number;
        parsedFiles: number;
        metadataOnlyFiles: number;
        skippedMetadataOnlyFiles: number;
        parseErrors: number;
        unaccountedFiles: string[];
      };
    };
    expect(facts.validation).toEqual({
      isComplete: true,
      inventoryFiles: 3,
      parseableFiles: 2,
      parsedFiles: 2,
      metadataOnlyFiles: 1,
      skippedMetadataOnlyFiles: 1,
      parseErrors: 0,
      unaccountedFiles: [],
    });
    expect(artifact?.type).toBe("analysisFacts");
    expect(artifact?.data).toMatchObject({
      inventoryArtifactId,
      files: {
        file_source: expect.objectContaining({
          path: "src/index.ts",
          language: "typescript",
        }),
        file_helper: expect.objectContaining({
          path: "src/helper.ts",
          language: "typescript",
        }),
      },
      symbols: expect.any(Object),
      imports: expect.any(Array),
      exports: expect.any(Array),
      dependencies: expect.any(Array),
      unresolvedImports: [],
      parseErrors: [],
      summary: facts.summary,
      validation: facts.validation,
    });
  });

  it("processes only parseable files and extracts imports, exports, and symbols", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      await createInventoryFixture(),
      "fixture inventory",
    );

    const response = parseJsonToolResult<AnalyzeResponse>(
      await createCodeAnalysisEngine().handle({ inventoryArtifactId }, store),
    );
    const artifact = store.get(response.artifactId);
    const facts = artifact?.data as {
      files: Record<string, { imports: string[]; exports: string[]; symbols: string[] }>;
      symbols: Record<string, { name: string; kind: string; fileId: string }>;
      imports: Array<{ fileId: string; rawSpecifier: string; importedSymbols: string[] }>;
      exports: Array<{ fileId: string; exportedSymbols: string[] }>;
    };

    expect(Object.keys(facts.files).sort()).toEqual(["file_helper", "file_source"]);
    expect(facts.files.file_source.imports).toEqual(["./helper.js"]);
    expect(facts.files.file_source.exports).toEqual(["User", "run"]);

    expect(Object.values(facts.symbols)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "file_source",
          kind: "interface",
          name: "User",
        }),
        expect.objectContaining({
          fileId: "file_source",
          kind: "function",
          name: "run",
        }),
      ]),
    );
    expect(facts.imports).toEqual([
      expect.objectContaining({
        fileId: "file_source",
        rawSpecifier: "./helper.js",
        importedSymbols: ["helper"],
      }),
    ]);
    expect(facts.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "file_source",
          exportedSymbols: ["User"],
        }),
        expect.objectContaining({
          fileId: "file_source",
          exportedSymbols: ["run"],
        }),
      ]),
    );
    const artifactSummary = (artifact?.data as { summary: Record<string, number> }).summary;
    expect(artifactSummary).toMatchObject({
      plannedFiles: 2,
      parsedFiles: 2,
      parseErrors: 0,
    });
    expect(artifactSummary.symbols).toBeGreaterThanOrEqual(2);
    expect(artifactSummary.imports).toBe(1);
    expect(artifactSummary.exports).toBeGreaterThanOrEqual(1);
  });

  it("builds file-level dependencies from relative imports", async () => {
    const store = new ArtifactStore();
    const inventoryArtifactId = store.put(
      "fileInventory",
      await createInventoryFixture(),
      "fixture inventory",
    );

    const response = parseJsonToolResult<AnalyzeResponse>(
      await createCodeAnalysisEngine().handle({ inventoryArtifactId }, store),
    );
    const artifact = store.get(response.artifactId);
    const facts = artifact?.data as {
      dependencies: Array<{
        fromFileId: string;
        toFileId: string;
        type: string;
        symbols: string[];
      }>;
      unresolvedImports: Array<{ fromFileId: string; rawSpecifier: string }>;
    };

    expect(facts.dependencies).toEqual([
      {
        fromFileId: "file_source",
        toFileId: "file_helper",
        type: "imports",
        symbols: ["helper"],
      },
    ]);
    expect(facts.unresolvedImports).toEqual([]);
    expect((artifact?.data as { summary: { dependencies: number } }).summary.dependencies).toBe(1);
  });
});
