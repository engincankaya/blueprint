/**
 * Shared contracts for applying LLM-reviewed group update decisions.
 */
import { type BlueprintOutput } from "../compose/compose.types.js";

export interface BlueprintReviewDecision {
  assignments: Array<{
    fileId: string;
    groupId: string;
  }>;
  newGroups: Array<{
    id: string;
    name: string;
    summary: string;
    fileIds: string[];
  }>;
  deleteGroups: string[];
}

export interface BlueprintReviewValidation {
  isValid: boolean;
  errors: string[];
}

export interface ApplyBlueprintReviewOptions {
  projectRoot: string;
}

export interface ApplyBlueprintReviewResult {
  output: BlueprintOutput;
  createdGroupDocs: string[];
  deletedGroupDocs: string[];
  deletedGroups: string[];
}

export interface GroupUpdateArgs {
  projectRoot: string;
  decision: BlueprintReviewDecision;
}
