/**
 * Validates LLM group update decisions against the current deterministic refresh state.
 */
import { type BlueprintOutput } from "../compose/compose.types.js";
import { type DeterministicBlueprintRefreshResult } from "../refresh/refresh.types.js";
import {
  type BlueprintReviewDecision,
  type BlueprintReviewValidation,
} from "./group-update.types.js";

export class GroupUpdateValidator {
  validate(
    output: BlueprintOutput,
    refresh: DeterministicBlueprintRefreshResult,
    decision: BlueprintReviewDecision,
  ): BlueprintReviewValidation {
    const errors: string[] = [];
    const unassigned = new Set(refresh.unassignedFiles.map((file) => file.fileId));
    const groups = new Set(output.groups.map((group) => group.id));
    const fileAssignments = new Map<string, number>();

    decision.assignments.forEach((assignment, index) => {
      const assignmentCount = this.countAssignment(fileAssignments, assignment.fileId);
      if (!unassigned.has(assignment.fileId)) {
        errors.push(`assignments[${index}].fileId ${assignment.fileId} is not an unassigned new file`);
      }
      if (!groups.has(assignment.groupId)) {
        errors.push(`assignments[${index}].groupId ${assignment.groupId} does not exist`);
      }
      if (assignmentCount === 2) {
        errors.push(`fileId ${assignment.fileId} is assigned more than once`);
      }
    });

    decision.newGroups.forEach((group, groupIndex) => {
      if (groups.has(group.id)) {
        errors.push(`newGroups[${groupIndex}].id ${group.id} already exists`);
      }
      group.fileIds.forEach((fileId, fileIndex) => {
        const assignmentCount = this.countAssignment(fileAssignments, fileId);
        if (!unassigned.has(fileId)) {
          errors.push(`newGroups[${groupIndex}].fileIds[${fileIndex}] ${fileId} is not an unassigned new file`);
        }
        if (assignmentCount === 2) {
          errors.push(`fileId ${fileId} is assigned more than once`);
        }
      });
    });

    const emptyGroups = new Set(refresh.emptyGroupCandidates.map((group) => group.groupId));
    decision.deleteGroups.forEach((groupId, index) => {
      if (!groups.has(groupId)) {
        errors.push(`deleteGroups[${index}] ${groupId} does not exist`);
      } else if (!emptyGroups.has(groupId)) {
        errors.push(`deleteGroups[${index}] ${groupId} is not empty`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private countAssignment(assignments: Map<string, number>, fileId: string): number {
    const count = (assignments.get(fileId) ?? 0) + 1;
    assignments.set(fileId, count);
    return count;
  }
}
