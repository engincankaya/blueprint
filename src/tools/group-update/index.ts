/**
 * Public blueprint.group.update tool for applying reviewed grouping decisions after refresh.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeProjectBrief } from "../../lib/brief-builder.js";
import { slugifyPathPart } from "../../lib/group-note-template.js";
import { jsonResult, type ToolResult } from "../../types.js";
import { type BlueprintOutput } from "../compose/compose.types.js";
import {
  unassignedGroupId,
} from "../refresh/index.js";
import { type DeterministicBlueprintRefreshResult } from "../refresh/refresh.types.js";
import { GroupUpdateApplier } from "./group-update-applier.js";
import { type GroupUpdateArgs } from "./group-update.types.js";
import { GroupUpdateValidator } from "./group-update-validator.js";

export class GroupUpdateTool {
  constructor(
    private readonly validator: GroupUpdateValidator,
    private readonly applier: GroupUpdateApplier,
  ) {}

  async handle(args: GroupUpdateArgs): Promise<ToolResult> {
    const blueprintPath = join(args.projectRoot, "blueprint", "blueprint-output.json");
    const output = JSON.parse(await readFile(blueprintPath, "utf-8")) as BlueprintOutput;
    const refresh = this.buildReviewStateFromOutput(output);
    const validation = this.validator.validate(output, refresh, args.decision);

    if (!validation.isValid) {
      return jsonResult({
        applied: false,
        validation,
      });
    }

    const applied = await this.applier.apply(
      output,
      refresh,
      args.decision,
      { projectRoot: args.projectRoot },
    );
    await writeFile(blueprintPath, JSON.stringify(applied.output, null, 2), "utf-8");
    await writeProjectBrief(
      join(args.projectRoot, "blueprint", "brief.md"),
      applied.output,
    );

    return jsonResult({
      applied: true,
      validation,
      assignedFiles: this.assignedFilesForDecision(applied.output, args.decision),
      createdGroups: args.decision.newGroups.map((group) => ({
        id: group.id,
        docsPath: this.groupDocsPath(group.id),
        fileIds: group.fileIds,
      })),
      deletedGroups: applied.deletedGroups,
      createdGroupDocs: applied.createdGroupDocs,
      deletedGroupDocs: applied.deletedGroupDocs,
      written: {
        blueprintOutputPath: "blueprint/blueprint-output.json",
        briefPath: "blueprint/brief.md",
      },
    });
  }

  private buildReviewStateFromOutput(
    output: BlueprintOutput,
  ): DeterministicBlueprintRefreshResult {
    const unassignedFiles = output.files
      .filter((file) => file.groupId === unassignedGroupId)
      .map((file) => ({
        fileId: file.id,
        path: file.path,
        category: file.category,
        language: file.language,
      }));
    const emptyGroupCandidates = output.groups
      .filter((group) => group.fileIds.length === 0)
      .map((group) => ({
        groupId: group.id,
        name: group.name,
        docsPath: group.docsPath,
        deletedFileIds: [],
      }));

    return {
      output,
      plan: {
        added: [],
        updated: [],
        deleted: [],
        unchanged: [],
        ignored: [],
        emptyGroupCandidates,
      },
      updatedFiles: [],
      deletedFiles: [],
      addedFiles: [],
      unassignedFiles,
      emptyGroupCandidates,
      affectedGroups: [],
    };
  }

  private assignedFilesForDecision(
    output: BlueprintOutput,
    decision: GroupUpdateArgs["decision"],
  ): Array<{ fileId: string; path: string; groupId: string }> {
    const files = new Map(output.files.map((file) => [file.id, file]));
    return [
      ...decision.assignments,
      ...decision.newGroups.flatMap((group) =>
        group.fileIds.map((fileId) => ({ fileId, groupId: group.id })),
      ),
    ].map((assignment) => {
      const file = files.get(assignment.fileId);
      return {
        fileId: assignment.fileId,
        path: file?.path ?? "",
        groupId: assignment.groupId,
      };
    });
  }

  private groupDocsPath(groupId: string): string {
    return `blueprint/groups/${slugifyPathPart(groupId)}.md`;
  }
}
