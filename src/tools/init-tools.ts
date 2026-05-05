import { ComposeArtifactWriter } from "./compose/compose-artifact-writer.js";
import { ComposeEntrypointDetector } from "./compose/compose-entrypoint-detector.js";
import { ComposeOutputBuilder } from "./compose/compose-output-builder.js";
import { ComposeTool } from "./compose/index.js";
import { GroupingAssignmentEngine } from "./group/grouping-assignment-engine.js";
import { GroupingPlanValidator } from "./group/grouping-plan-validator.js";
import { GroupTool } from "./group/index.js";
import { GroupUpdateApplier } from "./group-update/group-update-applier.js";
import { GroupUpdateValidator } from "./group-update/group-update-validator.js";
import { GroupUpdateTool } from "./group-update/index.js";
import { RefreshTool } from "./refresh/index.js";
import { CodeAnalysisEngine } from "./scan/scan-code-analysis-engine.js";
import { FileInventoryBuilder } from "./scan/scan-file-inventory-builder.js";
import { ScanTool } from "./scan/index.js";

export interface BlueprintTools {
  scanTool: ScanTool;
  groupTool: GroupTool;
  groupUpdateTool: GroupUpdateTool;
  refreshTool: RefreshTool;
  composeTool: ComposeTool;
}

export function initTools(): BlueprintTools {
  const fileInventoryBuilder = new FileInventoryBuilder();
  const codeAnalysisEngine = new CodeAnalysisEngine();
  const groupUpdateValidator = new GroupUpdateValidator();

  return {
    scanTool: new ScanTool(fileInventoryBuilder, codeAnalysisEngine),
    groupTool: new GroupTool(
      new GroupingPlanValidator(),
      new GroupingAssignmentEngine(),
    ),
    groupUpdateTool: new GroupUpdateTool(
      groupUpdateValidator,
      new GroupUpdateApplier(groupUpdateValidator),
    ),
    refreshTool: new RefreshTool(),
    composeTool: new ComposeTool(
      new ComposeOutputBuilder(new ComposeEntrypointDetector()),
      new ComposeArtifactWriter(),
    ),
  };
}
