/**
 * Blueprint file inventory stage.
 *
 * FileInventoryBuilder starts a repository analysis session by building the
 * file inventory that every later Blueprint step depends on. This class owns
 * repository-level facts such as canonical paths, stable file IDs, file hashes,
 * language detection, category hints, and parseability metadata.
 *
 * It should not parse source code or ask the LLM to interpret architecture.
 * Later scan stages use this inventory artifact to perform structural analysis,
 * semantic grouping, documentation, and final Blueprint composition.
 */
import fg from "fast-glob";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, normalize, relative, resolve } from "node:path";
import { type ArtifactStore } from "../../lib/artifact-store.js";
import { fileId as makeFileId, sha256 } from "../../lib/hashing.js";
import { type ToolResult, errorResult, jsonResult } from "../../types.js";

export type BlueprintFileCategory =
  | "source"
  | "test"
  | "config"
  | "documentation"
  | "asset"
  | "lockfile"
  | "generated"
  | "script"
  | "unknown";

export type BlueprintAnalysisLevel = "parseable" | "metadata-only";

export interface FileInventoryBuilderArgs {
  rootPath: string;
  ignore?: string[];
  maxFiles?: number;
  includeDefaultIgnored?: boolean;
}

export interface InventoryFile {
  fileId: string;
  path: string;
  absolutePath: string;
  language: string;
  sizeBytes: number;
  hash: string;
  category: BlueprintFileCategory;
  analysisLevel: BlueprintAnalysisLevel;
  parseable: boolean;
}

export interface FileInventorySummary {
  totalFiles: number;
  parseableFiles: number;
  metadataOnlyFiles: number;
  truncated: boolean;
  languages: Record<string, number>;
  categories: Record<BlueprintFileCategory, number>;
  analysisLevels: Record<BlueprintAnalysisLevel, number>;
  topLevelDirs: string[];
}

export interface FileInventoryValidation {
  isComplete: boolean;
  scannedFiles: number;
  inventoriedFiles: number;
  missingFiles: string[];
  duplicatePaths: string[];
  duplicateFileIds: string[];
}

export interface FileInventoryProject {
  name: string;
  rootPath: string;
  detectedStack: string[];
  packageManagers: string[];
}

export interface FileInventory {
  rootPath: string;
  options: {
    maxFiles: number;
    ignore: string[];
    respectGitignore: true;
    includeDefaultIgnored: boolean;
  };
  project: FileInventoryProject;
  files: InventoryFile[];
  summary: FileInventorySummary;
  validation: FileInventoryValidation;
}

export class FileInventoryBuilder {
  private readonly alwaysIgnore = [
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/target/**",
    "**/bin/**",
    "**/node_modules/**",
    "**/vendor/**",
    "**/.venv/**",
    "**/venv/**",
    "**/.cache/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",
    "**/.ruff_cache/**",
    "**/coverage/**",
    "**/htmlcov/**",
    "**/.env/**",
    "**/.blueprint/**",
  ];

  private readonly extensionLanguageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".pyi": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".swift": "swift",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".ex": "elixir",
    ".exs": "elixir",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".md": "markdown",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".svg": "svg",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".xml": "xml",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".proto": "protobuf",
    ".vue": "vue",
    ".svelte": "svelte",
  };

  private readonly parseableLanguages = new Set([
    "typescript",
    "tsx",
    "javascript",
    "python",
    "go",
    "rust",
    "java",
  ]);

  private increment<T extends string>(counts: Record<T, number>, key: T): void {
    counts[key] = (counts[key] ?? 0) + 1;
  }

  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    if (this.extensionLanguageMap[ext]) return this.extensionLanguageMap[ext];

    const base = basename(filePath).toLowerCase();
    if (base === "dockerfile" || base.startsWith("dockerfile."))
      return "dockerfile";
    if (base === "makefile" || base === "gnumakefile") return "makefile";
    if (base === "gemfile" || base === "rakefile") return "ruby";
    if (base === "go.mod" || base === "go.sum") return "go";

    return "unknown";
  }

  private classifyFile(
    filePath: string,
    language: string,
  ): BlueprintFileCategory {
    const normalized = filePath.replaceAll("\\", "/");
    const lowerPath = normalized.toLowerCase();
    const base = basename(lowerPath);
    const segments = lowerPath.split("/");

    if (
      base.endsWith(".test.ts") ||
      base.endsWith(".test.tsx") ||
      base.endsWith(".test.js") ||
      base.endsWith(".test.jsx") ||
      base.endsWith(".spec.ts") ||
      base.endsWith(".spec.tsx") ||
      base.endsWith(".spec.js") ||
      base.endsWith(".spec.jsx") ||
      segments.includes("test") ||
      segments.includes("tests") ||
      segments.includes("__tests__")
    ) {
      return "test";
    }

    if (
      base === "package-lock.json" ||
      base === "yarn.lock" ||
      base === "pnpm-lock.yaml" ||
      base === "cargo.lock" ||
      base === "poetry.lock"
    ) {
      return "lockfile";
    }

    if (
      base === ".gitignore" ||
      base === "package.json" ||
      base === "tsconfig.json" ||
      base.endsWith(".config.js") ||
      base.endsWith(".config.ts") ||
      base.endsWith(".config.mjs") ||
      base.endsWith(".config.cjs") ||
      ["json", "yaml", "toml", "xml"].includes(language)
    ) {
      return "config";
    }

    if (
      segments.includes("docs") ||
      base === "readme.md" ||
      base.endsWith(".md") ||
      language === "markdown"
    ) {
      return "documentation";
    }

    if (
      segments.includes("scripts") ||
      language === "shell" ||
      base.endsWith(".sh")
    ) {
      return "script";
    }

    if (
      segments.includes("assets") ||
      segments.includes("public") ||
      ["html", "css", "scss", "svg"].includes(language)
    ) {
      return "asset";
    }

    if (
      segments.includes("generated") ||
      segments.includes("__generated__") ||
      base.endsWith(".generated.ts") ||
      base.endsWith(".generated.js")
    ) {
      return "generated";
    }

    if (this.parseableLanguages.has(language)) {
      return "source";
    }

    return "unknown";
  }

  private gitignoreLineToPatterns(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      return [];
    }

    const unrooted = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const withoutTrailingSlash = unrooted.endsWith("/")
      ? unrooted.slice(0, -1)
      : unrooted;

    if (!withoutTrailingSlash) return [];

    if (withoutTrailingSlash.includes("*")) {
      return [withoutTrailingSlash];
    }

    if (withoutTrailingSlash.includes("/")) {
      return [withoutTrailingSlash, `${withoutTrailingSlash}/**`];
    }

    return [
      withoutTrailingSlash,
      `${withoutTrailingSlash}/**`,
      `**/${withoutTrailingSlash}`,
      `**/${withoutTrailingSlash}/**`,
    ];
  }

  private async readGitignorePatterns(rootPath: string): Promise<string[]> {
    try {
      const content = await readFile(resolve(rootPath, ".gitignore"), "utf-8");
      return content
        .split(/\r?\n/)
        .flatMap((line) => this.gitignoreLineToPatterns(line));
    } catch {
      return [];
    }
  }

  private topLevelDirs(paths: string[]): string[] {
    return Array.from(new Set(
      paths
        .map((path) => path.split("/")[0])
        .filter((part) => part && part.includes(".") === false),
    )).sort();
  }

  private detectPackageManagers(paths: string[]): string[] {
    const managers = new Set<string>();
    for (const path of paths) {
      const base = basename(path);
      if (base === "package.json") managers.add("npm");
      if (base === "pnpm-lock.yaml") managers.add("pnpm");
      if (base === "yarn.lock") managers.add("yarn");
      if (base === "Cargo.toml") managers.add("cargo");
      if (base === "go.mod") managers.add("go");
      if (base === "pyproject.toml" || base === "requirements.txt")
        managers.add("python");
      if (base === "pom.xml") managers.add("maven");
      if (base === "build.gradle" || base === "build.gradle.kts")
        managers.add("gradle");
    }
    return Array.from(managers).sort();
  }

  private detectStack(languages: Record<string, number>, paths: string[]): string[] {
    const stack = new Set<string>();
    for (const language of Object.keys(languages)) {
      if (language !== "unknown") stack.add(language);
    }
    if (paths.some((path) => path.endsWith("package.json"))) stack.add("node");
    if (paths.some((path) => path.includes("mcp-server/"))) stack.add("mcp");
    return Array.from(stack).sort();
  }

  private duplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        duplicated.add(value);
      } else {
        seen.add(value);
      }
    }
    return Array.from(duplicated).sort();
  }

  private validateInventory(
    scannedPaths: string[],
    files: InventoryFile[],
  ): FileInventoryValidation {
    const inventoriedPaths = new Set(files.map((file) => file.path));
    const missingFiles = scannedPaths
      .filter((path) => !inventoriedPaths.has(path))
      .sort();
    const duplicatePaths = this.duplicates(files.map((file) => file.path));
    const duplicateFileIds = this.duplicates(files.map((file) => file.fileId));

    return {
      isComplete:
        missingFiles.length === 0
        && duplicatePaths.length === 0
        && duplicateFileIds.length === 0
        && scannedPaths.length === files.length,
      scannedFiles: scannedPaths.length,
      inventoriedFiles: files.length,
      missingFiles,
      duplicatePaths,
      duplicateFileIds,
    };
  }

  async handle(
    args: FileInventoryBuilderArgs,
    store: ArtifactStore,
  ): Promise<ToolResult> {
    const {
      rootPath,
      ignore = [],
      maxFiles = 10000,
      includeDefaultIgnored = false,
    } = args;

    try {
      const gitignorePatterns = await this.readGitignorePatterns(rootPath);
      const defaultIgnore = includeDefaultIgnored ? [] : this.alwaysIgnore;
      const allIgnore = [...defaultIgnore, ...gitignorePatterns, ...ignore];
      const scanned = await fg("**/*", {
        cwd: rootPath,
        ignore: allIgnore,
        onlyFiles: true,
        dot: true,
        absolute: false,
        suppressErrors: true,
      });

      scanned.sort();
      const limited = scanned.slice(0, maxFiles);
      const languages: Record<string, number> = {};
      const categories: Record<BlueprintFileCategory, number> = {
        source: 0,
        test: 0,
        config: 0,
        documentation: 0,
        asset: 0,
        lockfile: 0,
        generated: 0,
        script: 0,
        unknown: 0,
      };
      const analysisLevels: Record<BlueprintAnalysisLevel, number> = {
        parseable: 0,
        "metadata-only": 0,
      };

      const files = await Promise.all(limited.map(async (relPath) => {
        const absolutePath = resolve(rootPath, relPath);
        const path = normalize(relative(rootPath, absolutePath));
        const language = this.detectLanguage(path);
        const parseable = this.parseableLanguages.has(language);
        const analysisLevel: BlueprintAnalysisLevel = parseable
          ? "parseable"
          : "metadata-only";
        const category = this.classifyFile(path, language);
        const fileStat = await stat(absolutePath);
        const buffer = await readFile(absolutePath);

        this.increment(languages, language);
        this.increment(categories, category);
        this.increment(analysisLevels, analysisLevel);

        return {
          fileId: makeFileId(path),
          path,
          absolutePath,
          language,
          sizeBytes: fileStat.size,
          hash: sha256(buffer.toString("base64")),
          category,
          analysisLevel,
          parseable,
        };
      }));

      const summary: FileInventorySummary = {
        totalFiles: files.length,
        parseableFiles: analysisLevels.parseable,
        metadataOnlyFiles: analysisLevels["metadata-only"],
        truncated: scanned.length > maxFiles,
        languages,
        categories,
        analysisLevels,
        topLevelDirs: this.topLevelDirs(limited),
      };

      const project: FileInventoryProject = {
        name: basename(resolve(rootPath)),
        rootPath,
        detectedStack: this.detectStack(languages, limited),
        packageManagers: this.detectPackageManagers(limited),
      };
      const validation = this.validateInventory(limited, files);

      const inventory: FileInventory = {
        rootPath,
        options: {
          maxFiles,
          ignore,
          respectGitignore: true,
          includeDefaultIgnored,
        },
        project,
        files,
        summary,
        validation,
      };

      const artifactId = store.put(
        "fileInventory",
        inventory,
        `File inventory: ${files.length} files`,
      );

      return jsonResult({
        artifactId,
        project: {
          name: project.name,
          detectedStack: project.detectedStack,
          packageManagers: project.packageManagers,
        },
        summary: {
          totalFiles: summary.totalFiles,
          parseableFiles: summary.parseableFiles,
          metadataOnlyFiles: summary.metadataOnlyFiles,
          truncated: summary.truncated,
        },
        validationStatus: {
          isComplete: validation.isComplete,
        },
      });
    } catch (err) {
      return errorResult(
        `File inventory build failed: ${err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
