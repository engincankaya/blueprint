import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { fileId as makeFileId, sha256 } from "../../src/lib/hashing.js";
import { parseJsonToolResult } from "../../src/types.js";
import {
  type FileInventory,
  FileInventoryBuilder,
} from "../../src/tools/scan/scan-file-inventory-builder.js";

function createFileInventoryBuilder(): FileInventoryBuilder {
  return new FileInventoryBuilder();
}

interface InitiateResponse {
  artifactId: string;
  project: {
    name: string;
    detectedStack: string[];
    packageManagers: string[];
  };
  summary: Pick<FileInventory["summary"], "totalFiles" | "parseableFiles" | "metadataOnlyFiles" | "truncated">;
  next?: unknown;
  validationStatus: {
    isComplete: boolean;
  };
  validation?: unknown;
  files?: unknown;
}

async function createFixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blueprint-initiate-"));

  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });

  await writeFile(join(root, ".gitignore"), "node_modules/\ndist/\n.env\n", "utf-8");
  await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf-8");
  await writeFile(join(root, "package-lock.json"), "{}\n", "utf-8");
  await writeFile(join(root, "tsconfig.json"), "{}\n", "utf-8");
  await writeFile(join(root, "src", "index.ts"), "export const answer = 42;\n", "utf-8");
  await writeFile(join(root, "src", "index.test.ts"), "import './index';\n", "utf-8");
  await writeFile(join(root, "scripts", "build.js"), "console.log('build');\n", "utf-8");
  await writeFile(join(root, "assets", "logo.svg"), "<svg />\n", "utf-8");
  await writeFile(join(root, "docs", "README.md"), "# Fixture\n", "utf-8");
  await writeFile(join(root, ".env"), "SECRET=1\n", "utf-8");
  await writeFile(join(root, "dist", "bundle.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored();\n", "utf-8");

  return root;
}

async function createDefaultIgnoreFixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blueprint-initiate-default-ignore-"));

  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "build"), { recursive: true });
  await mkdir(join(root, "target"), { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, "vendor"), { recursive: true });
  await mkdir(join(root, ".venv", "bin"), { recursive: true });
  await mkdir(join(root, "venv", "bin"), { recursive: true });
  await mkdir(join(root, ".cache"), { recursive: true });
  await mkdir(join(root, ".pytest_cache"), { recursive: true });
  await mkdir(join(root, ".mypy_cache"), { recursive: true });
  await mkdir(join(root, ".ruff_cache"), { recursive: true });
  await mkdir(join(root, "coverage"), { recursive: true });
  await mkdir(join(root, "htmlcov"), { recursive: true });

  await writeFile(join(root, ".gitignore"), "# no local ignores\n", "utf-8");
  await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf-8");
  await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n", "utf-8");
  await writeFile(join(root, "dist", "bundle.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, "build", "bundle.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, "target", "app"), "ignored\n", "utf-8");
  await writeFile(join(root, "bin", "app"), "ignored\n", "utf-8");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, "vendor", "lib.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, ".venv", "bin", "python"), "ignored\n", "utf-8");
  await writeFile(join(root, "venv", "bin", "python"), "ignored\n", "utf-8");
  await writeFile(join(root, ".cache", "state.json"), "{}\n", "utf-8");
  await writeFile(join(root, ".pytest_cache", "state"), "ignored\n", "utf-8");
  await writeFile(join(root, ".mypy_cache", "state.json"), "{}\n", "utf-8");
  await writeFile(join(root, ".ruff_cache", "state"), "ignored\n", "utf-8");
  await writeFile(join(root, "coverage", "lcov.info"), "TN:\n", "utf-8");
  await writeFile(join(root, "htmlcov", "index.html"), "<html></html>\n", "utf-8");
  await writeFile(join(root, "blueprint-output.json"), "{}\n", "utf-8");
  await writeFile(join(root, "blueprint-output.json"), "{}\n", "utf-8");

  return root;
}

function getInventory(store: ArtifactStore, artifactId: string): FileInventory {
  const inventory = store.getTyped<FileInventory>(artifactId, "fileInventory");
  expect(inventory).toBeDefined();
  return inventory as FileInventory;
}

describe("FileInventoryBuilder", () => {
  it("stores a gitignore-aware file inventory while returning only a compact response", async () => {
    const rootPath = await createFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({ rootPath }, store),
    );
    const inventory = getInventory(store, response.artifactId);
    const paths = inventory.files.map((file) => file.path).sort();

    expect(response.files).toBeUndefined();
    expect(response.next).toBeUndefined();
    expect(paths).toEqual([
      ".gitignore",
      "assets/logo.svg",
      "docs/README.md",
      "package-lock.json",
      "package.json",
      "scripts/build.js",
      "src/index.test.ts",
      "src/index.ts",
      "tsconfig.json",
    ]);
    expect(paths).not.toContain(".env");
    expect(paths.some((path) => path.startsWith("dist/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("node_modules/"))).toBe(false);
    expect(response.summary.totalFiles).toBe(9);
    expect(response.summary.truncated).toBe(false);
    expect(response.validationStatus).toEqual({
      isComplete: true,
    });
    expect(response.validation).toBeUndefined();
    expect(inventory.validation).toEqual({
      isComplete: true,
      scannedFiles: 9,
      inventoriedFiles: 9,
      missingFiles: [],
      duplicatePaths: [],
      duplicateFileIds: [],
    });
  });

  it("records stable file facts in the artifact, including absolute paths", async () => {
    const rootPath = await createFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({ rootPath }, store),
    );
    const inventory = getInventory(store, response.artifactId);
    const sourceFile = inventory.files.find((file) => file.path === "src/index.ts");
    const readmeFile = inventory.files.find((file) => file.path === "docs/README.md");

    expect(sourceFile).toMatchObject({
      fileId: makeFileId("src/index.ts"),
      path: "src/index.ts",
      absolutePath: join(rootPath, "src", "index.ts"),
      language: "typescript",
      sizeBytes: Buffer.byteLength("export const answer = 42;\n"),
      hash: sha256(Buffer.from("export const answer = 42;\n").toString("base64")),
      analysisLevel: "parseable",
      parseable: true,
      category: "source",
    });
    expect(readmeFile).toMatchObject({
      language: "markdown",
      analysisLevel: "metadata-only",
      parseable: false,
    });
  });

  it("classifies inventory files using deterministic path and language heuristics", async () => {
    const rootPath = await createFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({ rootPath }, store),
    );
    const inventory = getInventory(store, response.artifactId);
    const categoriesByPath = Object.fromEntries(
      inventory.files.map((file) => [file.path, file.category]),
    );

    expect(categoriesByPath).toMatchObject({
      ".gitignore": "config",
      "assets/logo.svg": "asset",
      "docs/README.md": "documentation",
      "package-lock.json": "lockfile",
      "package.json": "config",
      "scripts/build.js": "script",
      "src/index.test.ts": "test",
      "src/index.ts": "source",
      "tsconfig.json": "config",
    });
    expect(inventory.summary.categories).toMatchObject({
      asset: 1,
      config: 3,
      documentation: 1,
      lockfile: 1,
      script: 1,
      source: 1,
      test: 1,
      unknown: 0,
    });
  });

  it("summarizes languages, analysis levels, top-level directories, stack, and package managers", async () => {
    const rootPath = await createFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({ rootPath }, store),
    );
    const inventory = getInventory(store, response.artifactId);

    expect(response.summary).toMatchObject({
      totalFiles: 9,
      parseableFiles: 3,
      metadataOnlyFiles: 6,
    });
    expect(inventory.summary).toMatchObject({
      languages: {
        json: 3,
        javascript: 1,
        markdown: 1,
        svg: 1,
        typescript: 2,
        unknown: 1,
      },
      analysisLevels: {
        parseable: 3,
        "metadata-only": 6,
      },
      topLevelDirs: ["assets", "docs", "scripts", "src"],
    });
    expect(response.project.packageManagers).toEqual(["npm"]);
    expect(response.project.detectedStack).toEqual([
      "javascript",
      "json",
      "markdown",
      "node",
      "svg",
      "typescript",
    ]);
  });

  it("applies caller ignore patterns before maxFiles truncation and records options", async () => {
    const rootPath = await createFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({
        rootPath,
        ignore: ["docs/**", ".gitignore"],
        maxFiles: 2,
      }, store),
    );
    const inventory = getInventory(store, response.artifactId);

    expect(inventory.files.map((file) => file.path).sort()).toEqual([
      "assets/logo.svg",
      "package-lock.json",
    ]);
    expect(response.summary.truncated).toBe(true);
    expect(response.summary.totalFiles).toBe(2);
    expect(inventory.options).toEqual({
      maxFiles: 2,
      ignore: ["docs/**", ".gitignore"],
      respectGitignore: true,
      includeDefaultIgnored: false,
    });
  });

  it("ignores common build, vendor, cache, coverage, and derived-output paths by default", async () => {
    const rootPath = await createDefaultIgnoreFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({ rootPath }, store),
    );
    const inventory = getInventory(store, response.artifactId);
    const paths = inventory.files.map((file) => file.path).sort();

    expect(paths).toEqual([
      ".gitignore",
      "package.json",
      "src/index.ts",
    ]);
    expect(paths.some((path) => path.startsWith("dist/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("build/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("target/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("bin/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("vendor/"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".venv/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("venv/"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".cache/"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".pytest_cache/"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".mypy_cache/"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".ruff_cache/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("coverage/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("htmlcov/"))).toBe(false);
    expect(paths).not.toContain("blueprint-output.json");
    expect(paths).not.toContain("blueprint-output.json");
  });

  it("can include default-ignored paths when explicitly requested", async () => {
    const rootPath = await createDefaultIgnoreFixtureRepo();
    const store = new ArtifactStore();

    const response = parseJsonToolResult<InitiateResponse>(
      await createFileInventoryBuilder().handle({ rootPath, includeDefaultIgnored: true }, store),
    );
    const inventory = getInventory(store, response.artifactId);
    const paths = inventory.files.map((file) => file.path).sort();

    expect(paths).toEqual(
      expect.arrayContaining([
        "dist/bundle.js",
        "build/bundle.js",
        "target/app",
        "bin/app",
        "node_modules/pkg/index.js",
        "vendor/lib.js",
        ".venv/bin/python",
        "venv/bin/python",
        ".cache/state.json",
        ".pytest_cache/state",
        ".mypy_cache/state.json",
        ".ruff_cache/state",
        "coverage/lcov.info",
        "htmlcov/index.html",
        "blueprint-output.json",
        "blueprint-output.json",
      ]),
    );
    expect(inventory.options.includeDefaultIgnored).toBe(true);
  });
});
