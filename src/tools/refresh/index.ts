/**
 * Public refresh module for deterministic Blueprint diffing, patching, and summary formatting.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ArtifactStore } from "../../lib/artifact-store.js";
import {
  blueprintDir,
  blueprintOutputPath,
  blueprintOutputReadCandidates,
  isBlueprintGeneratedPath,
  refreshScanPath,
  refreshScanReadCandidates,
} from "../../lib/blueprint-paths.js";
import { errorResult, jsonResult, parseJsonToolResult, type ToolResult } from "../../types.js";
import { type BlueprintOutput } from "../compose/compose.types.js";
import { FileInventoryBuilder, type FileInventory } from "../scan/scan-file-inventory-builder.js";
import {
  type BlueprintRefreshPlan,
  type DeterministicBlueprintRefreshResult,
  type ScannedBlueprintFile,
} from "./refresh.types.js";

export const unassignedGroupId = "__unassigned__";

export interface RefreshToolArgs {
  projectRoot: string;
  dryRun?: boolean;
  changedPaths?: string[];
  ignore?: string[];
  includeDefaultIgnored?: boolean;
  maxFiles?: number;
}

export class RefreshTool {
  constructor(private readonly fileInventoryBuilder = new FileInventoryBuilder()) {}

  async handle(args: RefreshToolArgs): Promise<ToolResult> {
    try {
      const root = resolve(args.projectRoot);
      const previous = await this.readBlueprintOutput(root);
      const previousScan = await this.readRefreshScan(root);
      const currentScan = await this.scanCurrentFiles(root, args);
      const plan = this.buildPlan(previous, previousScan, currentScan, args.changedPaths ?? []);
      const refresh = this.apply(previous, plan);
      const maintenancePrompt = this.buildMaintenancePrompt(refresh);
      const shouldReview = this.hasReviewWork(refresh);

      if (args.dryRun !== true) {
        await mkdir(blueprintDir(root), { recursive: true });
        await writeFile(
          blueprintOutputPath(root),
          JSON.stringify(refresh.output, null, 2),
          "utf-8",
        );
        await writeFile(
          refreshScanPath(root),
          JSON.stringify(currentScan, null, 2),
          "utf-8",
        );
      }

      return jsonResult({
        summary: this.formatSummary(refresh),
        maintenancePrompt,
        refresh: {
          added: refresh.addedFiles,
          updated: refresh.updatedFiles,
          deleted: refresh.deletedFiles,
          unassignedFiles: refresh.unassignedFiles,
          emptyGroupCandidates: refresh.emptyGroupCandidates,
          affectedGroups: refresh.affectedGroups,
        },
        written: {
          blueprintOutputPath: args.dryRun === true ? "" : ".blueprint/blueprint-output.json",
          refreshScanPath: args.dryRun === true ? "" : ".blueprint/refresh-scan.json",
        },
        assistantNextSteps: {
          required: shouldReview,
          prompt: maintenancePrompt,
          tools: shouldReview ? ["blueprint.group.update"] : [],
        },
      });
    } catch (err) {
      return errorResult(
        `blueprint.refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  buildPlan(
    previous: BlueprintOutput,
    previousScan: ScannedBlueprintFile[],
    currentScan: ScannedBlueprintFile[],
    changedPaths: string[] = [],
  ): BlueprintRefreshPlan {
    const previousFilesByPath = new Map(previous.files.map((file) => [file.path, file]));
    const previousScanByPath = new Map(previousScan.map((file) => [file.path, file]));
    const currentRelevant = currentScan.filter((file) => !this.isIgnoredRefreshPath(file.path));
    const currentScanByPath = new Map(currentRelevant.map((file) => [file.path, file]));
    const changedPathSet = new Set(changedPaths);

    const added: BlueprintRefreshPlan["added"] = [];
    const updated: BlueprintRefreshPlan["updated"] = [];
    const unchanged: BlueprintRefreshPlan["unchanged"] = [];
    const deleted: BlueprintRefreshPlan["deleted"] = [];

    for (const current of currentRelevant) {
      const previousFile = previousFilesByPath.get(current.path);
      if (!previousFile) {
        added.push({
          fileId: current.id,
          path: current.path,
          category: current.category,
          language: current.language,
          hash: current.hash,
        });
        continue;
      }

      const previousScanFile = previousScanByPath.get(current.path);
      if ((previousScanFile && previousScanFile.hash !== current.hash) || (!previousScanFile && changedPathSet.has(current.path))) {
        updated.push({
          fileId: previousFile.id,
          path: current.path,
          groupId: previousFile.groupId,
          previousHash: previousScanFile?.hash ?? "",
          currentHash: current.hash,
        });
        continue;
      }

      unchanged.push({
        fileId: previousFile.id,
        path: current.path,
        groupId: previousFile.groupId,
        hash: current.hash,
      });
    }

    for (const previousFile of previous.files) {
      if (!currentScanByPath.has(previousFile.path)) {
        deleted.push({
          fileId: previousFile.id,
          path: previousFile.path,
          groupId: previousFile.groupId,
          previousHash: previousScanByPath.get(previousFile.path)?.hash ?? "",
        });
      }
    }

    const currentExistingFileIds = new Set(
      currentRelevant
        .map((file) => previousFilesByPath.get(file.path)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const deletedFileIdsByGroup = new Map<string, string[]>();
    for (const file of deleted) {
      deletedFileIdsByGroup.set(file.groupId, [
        ...(deletedFileIdsByGroup.get(file.groupId) ?? []),
        file.fileId,
      ]);
    }

    const emptyGroupCandidates = previous.groups
      .filter((group) => group.fileIds.length > 0)
      .filter((group) => group.fileIds.every((fileId) => !currentExistingFileIds.has(fileId)))
      .map((group) => ({
        groupId: group.id,
        name: group.name,
        docsPath: group.docsPath,
        deletedFileIds: deletedFileIdsByGroup.get(group.id) ?? [],
      }))
      .filter((group) => group.deletedFileIds.length > 0);

    return {
      added,
      updated,
      deleted,
      unchanged,
      ignored: currentScan.filter((file) => this.isIgnoredRefreshPath(file.path)),
      emptyGroupCandidates,
    };
  }

  apply(
    previous: BlueprintOutput,
    plan: BlueprintRefreshPlan,
  ): DeterministicBlueprintRefreshResult {
    const output: BlueprintOutput = structuredClone(previous);
    const deletedFileIds = new Set(plan.deleted.map((file) => file.fileId));
    const deletedPaths = new Set(plan.deleted.map((file) => file.path));

    output.files = output.files.filter((file) => !deletedFileIds.has(file.id));
    for (const file of plan.added) {
      output.files.push({
        id: file.fileId,
        path: file.path,
        groupId: unassignedGroupId,
        category: file.category,
        language: file.language,
        notesStatus: "not-required",
      });
    }

    output.groups = output.groups.map((group) => ({
      ...group,
      fileIds: group.fileIds.filter((fileId) => !deletedFileIds.has(fileId)),
    }));
    output.fileEdges = output.fileEdges.filter(
      (edge) => !deletedFileIds.has(edge.fromFileId) && !deletedFileIds.has(edge.toFileId),
    );
    output.symbols = output.symbols.filter((symbol) => !deletedFileIds.has(symbol.fileId));
    output.entrypoints = output.entrypoints.filter(
      (entrypoint) => !deletedPaths.has(entrypoint.path) && !deletedPaths.has(entrypoint.registrationPath),
    );
    output.testLinks = output.testLinks.filter(
      (link) => !deletedFileIds.has(link.sourceFileId) && !deletedFileIds.has(link.testFileId),
    );
    output.edges = output.edges.filter((edge) => {
      const fromGroup = output.groups.find((group) => group.id === edge.fromGroupId);
      const toGroup = output.groups.find((group) => group.id === edge.toGroupId);
      return Boolean(fromGroup && toGroup && fromGroup.fileIds.length > 0 && toGroup.fileIds.length > 0);
    });

    const affectedGroups = Array.from(new Set([
      ...plan.updated.map((file) => file.groupId),
      ...plan.deleted.map((file) => file.groupId),
      ...plan.emptyGroupCandidates.map((group) => group.groupId),
    ])).sort();

    const unassignedFiles = output.files
      .filter((file) => file.groupId === unassignedGroupId)
      .map((file) => ({
        fileId: file.id,
        path: file.path,
        category: file.category,
        language: file.language,
      }));

    return {
      output,
      plan,
      updatedFiles: plan.updated,
      deletedFiles: plan.deleted,
      addedFiles: plan.added,
      unassignedFiles,
      emptyGroupCandidates: plan.emptyGroupCandidates,
      affectedGroups,
    };
  }

  formatSummary(refresh: DeterministicBlueprintRefreshResult): string {
    return [
      "Blueprint refresh summary",
      `- added: ${refresh.addedFiles.length}${this.formatList(refresh.addedFiles.map((file) => file.path))}`,
      `- updated: ${refresh.updatedFiles.length}${this.formatList(refresh.updatedFiles.map((file) => `${file.path} -> ${file.groupId}`))}`,
      `- deleted: ${refresh.deletedFiles.length}${this.formatList(refresh.deletedFiles.map((file) => `${file.path} -> ${file.groupId}`))}`,
      `- unassigned: ${refresh.unassignedFiles.length}${this.formatList(refresh.unassignedFiles.map((file) => file.path))}`,
      `- empty groups: ${refresh.emptyGroupCandidates.length}${this.formatList(refresh.emptyGroupCandidates.map((group) => group.groupId))}`,
      `- affected groups: ${refresh.affectedGroups.length > 0 ? refresh.affectedGroups.join(", ") : "none"}`,
    ].join("\n");
  }

  buildMaintenancePrompt(refresh: DeterministicBlueprintRefreshResult): string {
    const groupSummaries = refresh.output.groups
      .map((group) => `- ${group.id}: ${group.name} - ${group.summary ?? ""}`)
      .join("\n");
    const filesById = new Map(refresh.output.files.map((file) => [file.id, file]));
    const pendingAssignmentById = new Map<string, {
      fileId: string;
      path: string;
      category: string;
      language: string;
    }>();
    for (const file of refresh.unassignedFiles) {
      pendingAssignmentById.set(file.fileId, file);
    }
    for (const file of refresh.updatedFiles) {
      if (file.groupId !== unassignedGroupId) continue;
      const outputFile = filesById.get(file.fileId);
      pendingAssignmentById.set(file.fileId, {
        fileId: file.fileId,
        path: file.path,
        category: outputFile?.category ?? "unknown",
        language: outputFile?.language ?? "unknown",
      });
    }
    const pendingAssignments = Array.from(pendingAssignmentById.values());
    const newFiles = pendingAssignments
      .map((file) => `- ${file.fileId}: ${file.path} (${file.category}, ${file.language})`)
      .join("\n") || "- None";
    const updatedFiles = refresh.updatedFiles
      .filter((file) => file.groupId !== unassignedGroupId)
      .map((file) => `- ${file.fileId}: ${file.path} -> ${file.groupId}`)
      .join("\n") || "- None";
    const deletedFiles = refresh.deletedFiles
      .map((file) => `- ${file.fileId}: ${file.path} -> ${file.groupId}`)
      .join("\n") || "- None";
    const emptyGroups = refresh.emptyGroupCandidates
      .map((group) => `- ${group.groupId}: ${group.name} (${group.docsPath})`)
      .join("\n") || "- None";
    const affectedGroups = refresh.affectedGroups
      .map((groupId) => {
        const group = refresh.output.groups.find((candidate) => candidate.id === groupId);
        return group ? `- ${group.id}: ${group.docsPath}` : `- ${groupId}`;
      })
      .join("\n") || "- None";

    return [
      "Blueprint JSON was refreshed deterministically.",
      "",
      "Rules:",
      "- Do not edit `blueprint-output.json` manually.",
      "- If an assignment or empty group decision is needed, use the `blueprint.group.update` tool.",
      "- Do not use the tool for updated/deleted files; backend cleanup and refresh are already done.",
      "- After the tool succeeds, update only the group markdown files that actually need memory changes.",
      "- Do not touch markdown files that do not need changes.",
      "",
      "1) Decisions that may require a tool call",
      "",
      "Files waiting for assignment:",
      newFiles,
      "",
      "Empty group candidates:",
      emptyGroups,
      "",
      "Tool to use:",
      "`blueprint.group.update`",
      "",
      "2) Markdown memory review context",
      "",
      "Updated files:",
      updatedFiles,
      "",
      "Deleted files:",
      deletedFiles,
      "",
      "Affected group docs:",
      affectedGroups,
      "",
      "Existing groups:",
      groupSummaries || "- None",
      "",
      "Final steps:",
      "- First, call `blueprint.group.update` if needed.",
      "- Then read and update only the group markdown files that need memory changes.",
    ].join("\n");
  }

  private async scanCurrentFiles(
    root: string,
    args: Pick<RefreshToolArgs, "ignore" | "includeDefaultIgnored" | "maxFiles">,
  ): Promise<ScannedBlueprintFile[]> {
    const store = new ArtifactStore();
    const response = parseJsonToolResult<{ artifactId: string }>(
      await this.fileInventoryBuilder.handle({
        rootPath: root,
        ignore: args.ignore,
        includeDefaultIgnored: args.includeDefaultIgnored,
        maxFiles: args.maxFiles,
      }, store),
    );
    const inventory = store.getTyped<FileInventory>(response.artifactId, "fileInventory");
    if (!inventory) {
      throw new Error("file inventory was not created");
    }

    return inventory.files.map((file) => ({
      id: file.fileId,
      path: file.path,
      hash: file.hash,
      category: file.category,
      language: file.language,
      sizeBytes: file.sizeBytes,
    }));
  }

  private async readBlueprintOutput(root: string): Promise<BlueprintOutput> {
    for (const path of blueprintOutputReadCandidates(root)) {
      try {
        return JSON.parse(await readFile(path, "utf-8")) as BlueprintOutput;
      } catch {
        // Try the next supported output location.
      }
    }
    throw new Error("blueprint-output.json was not found");
  }

  private async readRefreshScan(root: string): Promise<ScannedBlueprintFile[]> {
    for (const path of refreshScanReadCandidates(root)) {
      try {
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? parsed.filter(this.isScannedBlueprintFile)
          : [];
      } catch {
        // Try the next supported scan location.
      }
    }
    return [];
  }

  private isScannedBlueprintFile(value: unknown): value is ScannedBlueprintFile {
    return typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && typeof (value as { id?: unknown }).id === "string"
      && typeof (value as { path?: unknown }).path === "string"
      && typeof (value as { hash?: unknown }).hash === "string"
      && typeof (value as { category?: unknown }).category === "string"
      && typeof (value as { language?: unknown }).language === "string";
  }

  private hasReviewWork(refresh: DeterministicBlueprintRefreshResult): boolean {
    return refresh.unassignedFiles.length > 0
      || refresh.emptyGroupCandidates.length > 0
      || refresh.updatedFiles.length > 0
      || refresh.deletedFiles.length > 0;
  }

  private isIgnoredRefreshPath(path: string): boolean {
    return isBlueprintGeneratedPath(path)
      || path.startsWith(".cache/");
  }

  private formatList(items: string[]): string {
    return items.length > 0 ? ` (${items.join(", ")})` : "";
  }
}
