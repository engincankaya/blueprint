/**
 * Applies validated group update decisions and manages group markdown templates.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { groupDocsDir, groupDocsRelativePath } from "../../lib/blueprint-paths.js";
import { renderGroupVisionNoteTemplate, slugifyPathPart } from "../../lib/group-note-template.js";
import { type BlueprintOutput } from "../compose/compose.types.js";
import { type DeterministicBlueprintRefreshResult } from "../refresh/refresh.types.js";
import { GroupUpdateValidator } from "./group-update-validator.js";
import {
  type ApplyBlueprintReviewOptions,
  type ApplyBlueprintReviewResult,
  type BlueprintReviewDecision,
} from "./group-update.types.js";

export class GroupUpdateApplier {
  constructor(
    private readonly validator: GroupUpdateValidator,
  ) {}

  async apply(
    output: BlueprintOutput,
    refresh: DeterministicBlueprintRefreshResult,
    decision: BlueprintReviewDecision,
    options: ApplyBlueprintReviewOptions,
  ): Promise<ApplyBlueprintReviewResult> {
    const validation = this.validator.validate(output, refresh, decision);
    if (!validation.isValid) {
      throw new Error(`Invalid Blueprint review decision: ${validation.errors.join("; ")}`);
    }

    const next: BlueprintOutput = structuredClone(output);
    const filesById = new Map(next.files.map((file) => [file.id, file]));
    const groupsById = new Map(next.groups.map((group) => [group.id, group]));
    const createdGroupDocs: string[] = [];
    const deletedGroupDocs: string[] = [];
    const deletedGroups: string[] = [];

    for (const assignment of decision.assignments) {
      const file = filesById.get(assignment.fileId);
      const group = groupsById.get(assignment.groupId);
      if (!file || !group) continue;
      file.groupId = assignment.groupId;
      if (!group.fileIds.includes(file.id)) {
        group.fileIds.push(file.id);
      }
    }

    for (const group of decision.newGroups) {
      const docsPath = this.groupDocsPath(group.id);
      next.groups.push({
        id: group.id,
        name: group.name,
        summary: group.summary,
        docsPath,
        fileIds: [...group.fileIds],
      });
      for (const fileId of group.fileIds) {
        const file = filesById.get(fileId);
        if (file) file.groupId = group.id;
      }
      createdGroupDocs.push(docsPath);
      await this.writeGroupTemplate(options.projectRoot, group.id, group.name, docsPath);
    }

    for (const groupId of decision.deleteGroups) {
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) continue;
      next.groups = next.groups.filter((candidate) => candidate.id !== groupId);
      next.edges = next.edges.filter(
        (edge) => edge.fromGroupId !== groupId && edge.toGroupId !== groupId,
      );
      deletedGroups.push(groupId);
      deletedGroupDocs.push(group.docsPath);
      await rm(join(options.projectRoot, group.docsPath), { force: true });
    }

    return {
      output: next,
      createdGroupDocs,
      deletedGroupDocs,
      deletedGroups,
    };
  }

  private groupDocsPath(groupId: string): string {
    return groupDocsRelativePath(slugifyPathPart(groupId));
  }

  private async writeGroupTemplate(
    projectRoot: string,
    groupId: string,
    groupName: string,
    docsPath: string,
  ): Promise<void> {
    await mkdir(groupDocsDir(projectRoot), { recursive: true });
    await writeFile(
      join(projectRoot, docsPath),
      renderGroupVisionNoteTemplate({
        group: {
          id: groupId,
          name: groupName,
        },
        factSnapshot: "refresh",
      }),
      "utf-8",
    );
  }
}
