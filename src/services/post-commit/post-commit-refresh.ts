import { type BlueprintOutput } from "../../tools/compose/compose.types.js";
import { RefreshTool } from "../../tools/refresh/index.js";
import {
  type DeterministicBlueprintRefreshResult,
  type ScannedBlueprintFile,
} from "../../tools/refresh/refresh.types.js";

export class PostCommitRefreshAdapter {
  constructor(private readonly refreshTool = new RefreshTool()) {}

  refresh(args: {
    previous: BlueprintOutput;
    previousScan: ScannedBlueprintFile[];
    currentScan: ScannedBlueprintFile[];
    changedPaths: string[];
  }): DeterministicBlueprintRefreshResult {
    const plan = this.refreshTool.buildPlan(
      args.previous,
      args.previousScan,
      args.currentScan,
      args.changedPaths,
    );
    return this.refreshTool.apply(args.previous, plan);
  }
}
