/**
 * Blueprint structural analysis stage.
 *
 * CodeAnalysisEngine reads the file inventory produced by FileInventoryBuilder,
 * selects parseable files, and stores deterministic code facts for later
 * grouping and documentation. This stage owns imports, exports, symbols,
 * dependency edges, unresolved imports, and parse errors.
 *
 * The initial implementation establishes the artifact contract and compact
 * response shape. Tree-sitter parsing is added incrementally after the tool
 * boundary is covered by tests.
 */
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { type ArtifactStore } from "../../lib/artifact-store.js";
import { symbolId as makeSymbolId } from "../../lib/hashing.js";
import { createParser } from "../../lib/tree-sitter-loader.js";
import { getNormalizer } from "../../languages/registry.js";
import { type ToolResult, errorResult, jsonResult } from "../../types.js";
import { type FileInventory } from "./scan-file-inventory-builder.js";

export interface CodeAnalysisEngineArgs {
  inventoryArtifactId: string;
}

export interface AnalysisSymbol {
  symbolId: string;
  fileId: string;
  name: string;
  kind: string;
  visibility?: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  decorators?: string[];
  typeAnnotations?: string[];
  docComment?: string;
}

export interface AnalysisImport {
  fileId: string;
  rawSpecifier: string;
  kind: string;
  importedSymbols: string[];
}

export interface AnalysisExport {
  fileId: string;
  kind: string;
  exportedSymbols: string[];
}

export interface FileDependency {
  fromFileId: string;
  toFileId: string;
  type: string;
  symbols: string[];
}

export interface AnalyzedFile {
  fileId: string;
  path: string;
  language: string;
  imports: string[];
  exports: string[];
  symbols: string[];
}

export interface AnalysisSummary {
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
}

export interface AnalysisValidation {
  isComplete: boolean;
  inventoryFiles: number;
  parseableFiles: number;
  parsedFiles: number;
  metadataOnlyFiles: number;
  skippedMetadataOnlyFiles: number;
  parseErrors: number;
  unaccountedFiles: string[];
}

export interface AnalysisFacts {
  inventoryArtifactId: string;
  rootPath: string;
  files: Record<string, AnalyzedFile>;
  symbols: Record<string, AnalysisSymbol>;
  imports: AnalysisImport[];
  exports: AnalysisExport[];
  dependencies: FileDependency[];
  unresolvedImports: Array<{ fromFileId: string; rawSpecifier: string }>;
  parseErrors: Array<{ fileId: string; error: string }>;
  summary: AnalysisSummary;
  validation: AnalysisValidation;
}

export class CodeAnalysisEngine {
  private normalizePath(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

  private candidateImportPaths(fromPath: string, rawSpecifier: string): string[] {
  const basePath = this.normalizePath(join(dirname(fromPath), rawSpecifier));
  const ext = extname(basePath);

  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    const withoutExt = basePath.slice(0, -ext.length);
    return [
      `${withoutExt}.ts`,
      `${withoutExt}.tsx`,
      `${withoutExt}.js`,
      `${withoutExt}.jsx`,
      `${withoutExt}/index.ts`,
      `${withoutExt}/index.tsx`,
      `${withoutExt}/index.js`,
      `${withoutExt}/index.jsx`,
    ];
  }

  if (ext) {
    return [basePath];
  }

  return [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ];
}

  private buildPathToFileId(inventory: FileInventory): Map<string, string> {
  return new Map(
    inventory.files.map((file) => [this.normalizePath(file.path), file.fileId]),
  );
}

  private resolveRelativeImport(
  fromPath: string,
  rawSpecifier: string,
  pathToFileId: Map<string, string>,
): string | undefined {
  for (const candidate of this.candidateImportPaths(fromPath, rawSpecifier)) {
    const fileId = pathToFileId.get(candidate);
    if (fileId) return fileId;
  }
  return undefined;
}

  private validateAnalysisCoverage(
  inventory: FileInventory,
  facts: Omit<AnalysisFacts, "validation">,
): AnalysisValidation {
  const parsedFileIds = new Set(Object.keys(facts.files));
  const parseErrorFileIds = new Set(facts.parseErrors.map((error) => error.fileId));
  const unaccountedFiles = inventory.files
    .filter((file) => {
      if (file.analysisLevel === "metadata-only") return false;
      return !parsedFileIds.has(file.fileId) && !parseErrorFileIds.has(file.fileId);
    })
    .map((file) => file.fileId)
    .sort();
  const skippedMetadataOnlyFiles = inventory.files.filter(
    (file) => file.analysisLevel === "metadata-only",
  ).length;

  return {
    isComplete:
      unaccountedFiles.length === 0
      && inventory.files.length
        === parsedFileIds.size + parseErrorFileIds.size + skippedMetadataOnlyFiles,
    inventoryFiles: inventory.files.length,
    parseableFiles: inventory.summary.parseableFiles,
    parsedFiles: parsedFileIds.size,
    metadataOnlyFiles: inventory.summary.metadataOnlyFiles,
    skippedMetadataOnlyFiles,
    parseErrors: facts.parseErrors.length,
    unaccountedFiles,
  };
}

  async handle(
  args: CodeAnalysisEngineArgs,
  store: ArtifactStore,
): Promise<ToolResult> {
  const entry = store.get(args.inventoryArtifactId);
  if (!entry) {
    return errorResult(
      `File inventory artifact ${args.inventoryArtifactId} not found`,
    );
  }

  const inventory = store.getTyped<FileInventory>(
    args.inventoryArtifactId,
    "fileInventory",
  );
  if (!inventory) {
    return errorResult(
      `File inventory artifact ${args.inventoryArtifactId} not found or has the wrong type`,
    );
  }

  const parseableFiles = inventory.files.filter(
    (file) => file.analysisLevel === "parseable",
  );
  const pathToFileId = this.buildPathToFileId(inventory);
  const facts: AnalysisFacts = {
    inventoryArtifactId: args.inventoryArtifactId,
    rootPath: inventory.rootPath,
    files: {},
    symbols: {},
    imports: [],
    exports: [],
    dependencies: [],
    unresolvedImports: [],
    parseErrors: [],
    summary: {
      totalFiles: inventory.summary.totalFiles,
      parseableFiles: inventory.summary.parseableFiles,
      metadataOnlyFiles: inventory.summary.metadataOnlyFiles,
      plannedFiles: parseableFiles.length,
      parsedFiles: 0,
      symbols: 0,
      imports: 0,
      exports: 0,
      dependencies: 0,
      parseErrors: 0,
    },
    validation: {
      isComplete: false,
      inventoryFiles: inventory.files.length,
      parseableFiles: inventory.summary.parseableFiles,
      parsedFiles: 0,
      metadataOnlyFiles: inventory.summary.metadataOnlyFiles,
      skippedMetadataOnlyFiles: inventory.summary.metadataOnlyFiles,
      parseErrors: 0,
      unaccountedFiles: [],
    },
  };

  for (const file of parseableFiles) {
    try {
      const source = await readFile(file.absolutePath, "utf-8");
      const parser = await createParser(file.language);
      if (!parser) {
        facts.parseErrors.push({
          fileId: file.fileId,
          error: `Failed to create parser for ${file.language}`,
        });
        continue;
      }

      const normalizer = getNormalizer(file.language);
      if (!normalizer) {
        facts.parseErrors.push({
          fileId: file.fileId,
          error: `No normalizer for ${file.language}`,
        });
        continue;
      }

      const result = normalizer.normalize(parser.parse(source), source);
      const importIds: string[] = [];
      const exportIds: string[] = [];
      const symbolIds: string[] = [];

      for (const imp of result.imports) {
        facts.imports.push({
          fileId: file.fileId,
          rawSpecifier: imp.rawSpecifier,
          kind: imp.kind,
          importedSymbols: imp.importedSymbols,
        });
        importIds.push(imp.rawSpecifier);
        if (imp.rawSpecifier.startsWith(".") || imp.rawSpecifier.startsWith("/")) {
          const toFileId = this.resolveRelativeImport(
            file.path,
            imp.rawSpecifier,
            pathToFileId,
          );
          if (toFileId) {
            facts.dependencies.push({
              fromFileId: file.fileId,
              toFileId,
              type: "imports",
              symbols: imp.importedSymbols,
            });
          }
        } else {
          facts.unresolvedImports.push({
            fromFileId: file.fileId,
            rawSpecifier: imp.rawSpecifier,
          });
        }
      }

      for (const exp of result.exports) {
        facts.exports.push({
          fileId: file.fileId,
          kind: exp.kind,
          exportedSymbols: exp.exportedSymbols,
        });
        exportIds.push(...exp.exportedSymbols);
      }

      for (const symbol of result.symbols) {
        const symbolId = makeSymbolId(file.fileId, symbol.kind, symbol.name);
        facts.symbols[symbolId] = {
          symbolId,
          fileId: file.fileId,
          name: symbol.name,
          kind: symbol.kind,
          visibility: symbol.visibility,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          signature: symbol.signature,
          decorators: symbol.decorators,
          typeAnnotations: symbol.typeAnnotations,
          docComment: symbol.docComment,
        };
        symbolIds.push(symbolId);
      }

      facts.files[file.fileId] = {
        fileId: file.fileId,
        path: file.path,
        language: file.language,
        imports: importIds,
        exports: Array.from(new Set(exportIds)),
        symbols: symbolIds,
      };
      facts.summary.parsedFiles += 1;
    } catch (err) {
      facts.parseErrors.push({
        fileId: file.fileId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  facts.summary.symbols = Object.keys(facts.symbols).length;
  facts.summary.imports = facts.imports.length;
  facts.summary.exports = facts.exports.length;
  facts.summary.dependencies = facts.dependencies.length;
  facts.summary.parseErrors = facts.parseErrors.length;
  facts.validation = this.validateAnalysisCoverage(inventory, facts);

  const artifactId = store.put(
    "analysisFacts",
    facts,
    `Analysis facts: ${facts.summary.parsedFiles}/${facts.summary.plannedFiles} parsed files`,
  );

  return jsonResult({
    artifactId,
    summary: {
      totalFiles: facts.summary.totalFiles,
      parsedFiles: facts.summary.parsedFiles,
      parseErrors: facts.summary.parseErrors,
    },
    validationStatus: {
      isComplete: facts.validation.isComplete,
    },
    next: {
      tool: "blueprint.group",
      input: {
        analysisArtifactId: artifactId,
      },
    },
  });
}
}
