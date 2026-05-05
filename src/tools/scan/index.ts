/**
 * Blueprint scan stage.
 *
 * `blueprint.scan` is the public entry point for the Blueprint pipeline. It
 * builds the file inventory, runs deterministic code analysis, stores both
 * artifacts, and returns the compact analysis response needed by grouping.
 */
import { type ArtifactStore } from "../../lib/artifact-store.js";
import { type ToolResult, errorResult, jsonResult, parseJsonToolResult } from "../../types.js";
import { CodeAnalysisEngine, type CodeAnalysisEngineArgs } from "./scan-code-analysis-engine.js";
import { FileInventoryBuilder, type FileInventoryBuilderArgs } from "./scan-file-inventory-builder.js";

export type ScanArgs = FileInventoryBuilderArgs;

interface FileInventoryCompactResponse {
  artifactId: string;
  validationStatus: {
    isComplete: boolean;
  };
}

interface CodeAnalysisCompactResponse {
  artifactId: string;
  summary: {
    totalFiles: number;
    parsedFiles: number;
    parseErrors: number;
  };
  validationStatus: {
    isComplete: boolean;
  };
  next: {
    tool: "blueprint.group";
    input: {
      analysisArtifactId: string;
    };
  };
}

export class ScanTool {
  constructor(
    private readonly fileInventoryBuilder: FileInventoryBuilder,
    private readonly codeAnalysisEngine: CodeAnalysisEngine,
  ) {}

  async handle(
    args: ScanArgs,
    store: ArtifactStore,
  ): Promise<ToolResult> {
    try {
      const inventoryResponse = parseJsonToolResult<FileInventoryCompactResponse>(
        await this.fileInventoryBuilder.handle(args, store),
      );
      const analysisArgs: CodeAnalysisEngineArgs = {
        inventoryArtifactId: inventoryResponse.artifactId,
      };
      const analysisResponse = parseJsonToolResult<CodeAnalysisCompactResponse>(
        await this.codeAnalysisEngine.handle(analysisArgs, store),
      );

      return jsonResult({
        artifactId: analysisResponse.artifactId,
        inventoryArtifactId: inventoryResponse.artifactId,
        summary: analysisResponse.summary,
        validationStatus: {
          isComplete:
            inventoryResponse.validationStatus.isComplete
            && analysisResponse.validationStatus.isComplete,
        },
        next: analysisResponse.next,
      });
    } catch (err) {
      return errorResult(
        `blueprint.scan failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
