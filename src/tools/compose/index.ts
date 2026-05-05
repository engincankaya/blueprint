/**
 * Blueprint compose stage.
 *
 * `blueprint.compose` builds the final frontend-ready Blueprint JSON from the
 * stored grouping artifact. It deterministically joins groups, files, edges,
 * docs paths, and validation into a stable `blueprint.v1` output shape.
 */
import { type ArtifactStore } from "../../lib/artifact-store.js";
import { type ToolResult, errorResult, jsonResult } from "../../types.js";
import { type GroupingResult } from "../group/grouping.types.js";
import { type AnalysisFacts } from "../scan/scan-code-analysis-engine.js";
import { type FileInventory } from "../scan/scan-file-inventory-builder.js";
import { ComposeArtifactWriter } from "./compose-artifact-writer.js";
import { ComposeEntrypointDetector } from "./compose-entrypoint-detector.js";
import { ComposeOutputBuilder } from "./compose-output-builder.js";
import {
  type ComposeArgs,
  type ComposeResponseValidation,
} from "./compose.types.js";

export class ComposeTool {
  constructor(
    private readonly outputBuilder: ComposeOutputBuilder,
    private readonly artifactWriter: ComposeArtifactWriter,
  ) {}

  async handle(args: ComposeArgs, store: ArtifactStore): Promise<ToolResult> {
    const grouping = this.getGrouping(args.groupingArtifactId, store);
    if (!grouping) {
      const entry = store.get(args.groupingArtifactId);
      return errorResult(
        entry
          ? `Grouping artifact ${args.groupingArtifactId} not found or has the wrong type`
          : `Grouping artifact ${args.groupingArtifactId} not found`,
      );
    }

    const inventory = this.getInventory(grouping, store);
    const analysis = this.getAnalysis(grouping, store);
    const output = await this.outputBuilder.build(grouping, analysis, inventory, args.language ?? "English");
    let rootPath: string | undefined;
    if (inventory) {
      rootPath = inventory.rootPath;
      await this.artifactWriter.write(inventory.rootPath, output);
    }

    const assistantNextSteps = await this.artifactWriter.buildAssistantNextSteps(output, rootPath);
    const artifactId = store.put(
      "blueprintOutput",
      output,
      `Blueprint output: ${output.groups.length} groups, ${output.files.length} files`,
    );

    return jsonResult({
      artifactId,
      summary: {
        groups: output.groups.length,
        files: output.files.length,
        edges: output.edges.length,
      },
      validation: {
        isValid: output.validation.isValid,
        groupingComplete: output.validation.groupingComplete,
        groupingIssueSummary: output.validation.groupingIssueSummary,
        groupingWarningSummary: output.validation.groupingWarningSummary,
      } satisfies ComposeResponseValidation,
      assistantNextSteps,
      output,
    });
  }

  private getGrouping(
    groupingArtifactId: string,
    store: ArtifactStore,
  ): GroupingResult | undefined {
    return store.getTyped<GroupingResult>(
      groupingArtifactId,
      "groupingResult",
    );
  }

  private getInventory(
    grouping: GroupingResult,
    store: ArtifactStore,
  ): FileInventory | undefined {
    return store.getTyped<FileInventory>(
      grouping.inventoryArtifactId,
      "fileInventory",
    );
  }

  private getAnalysis(
    grouping: GroupingResult,
    store: ArtifactStore,
  ): AnalysisFacts | undefined {
    if (!store.get(grouping.analysisArtifactId)) {
      return undefined;
    }
    return store.getTyped<AnalysisFacts>(
      grouping.analysisArtifactId,
      "analysisFacts",
    );
  }
}
