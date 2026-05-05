import {
  type AnalysisFacts,
} from "../scan/scan-code-analysis-engine.js";
import {
  type BlueprintFileCategory,
  type FileInventory,
} from "../scan/scan-file-inventory-builder.js";
import {
  type BlueprintGroup,
  type GroupEdge,
  type GroupedFile,
  type GroupingPlan,
  type GroupingResult,
  type GroupValidation,
  type UnknownPattern,
  type ValidationFileRef,
} from "./grouping.types.js";

export class GroupingAssignmentEngine {
  apply(
    analysisArtifactId: string,
    inventory: FileInventory,
    facts: AnalysisFacts,
    plan: GroupingPlan,
  ): GroupingResult {
    const unknownPatterns: UnknownPattern[] = [];
    const matchedByFile = new Map<string, string[]>();
    const planGroupFiles = new Map<string, Set<string>>();

    for (const group of plan.groups) {
      const includeMatches = new Set<string>();
      for (const pattern of group.include) {
        const matches = this.matchingFileIds(inventory, pattern);
        if (matches.size === 0) {
          unknownPatterns.push(this.unknownPattern(inventory, pattern));
        }
        for (const fileId of matches) includeMatches.add(fileId);
      }

      const excludeMatches = new Set<string>();
      for (const pattern of group.exclude ?? []) {
        const matches = this.matchingFileIds(inventory, pattern);
        if (matches.size === 0) {
          unknownPatterns.push(this.unknownPattern(inventory, pattern));
        }
        for (const fileId of matches) excludeMatches.add(fileId);
      }

      for (const fileId of excludeMatches) includeMatches.delete(fileId);
      planGroupFiles.set(group.id, includeMatches);

      for (const fileId of includeMatches) {
        matchedByFile.set(fileId, [...(matchedByFile.get(fileId) ?? []), group.id]);
      }
    }

    const duplicateAssignments = Array.from(matchedByFile.entries())
      .filter(([, groupIds]) => groupIds.length > 1)
      .map(([fileId, groupIds]) => {
        const file = inventory.files.find((item) => item.fileId === fileId);
        return {
          ...(file
            ? this.validationFileRef(file)
            : { fileId, path: fileId, category: "unknown" as const, language: "unknown" }),
          groupIds,
        };
      });

    const fileToGroup = new Map<string, string>();
    for (const [fileId, groupIds] of matchedByFile.entries()) {
      fileToGroup.set(fileId, groupIds[0]);
    }

    const unassignedFiles: ValidationFileRef[] = [];
    const fallbackAssignments: Array<ValidationFileRef & { fallbackGroupId: string }> = [];
    const fallbackGroups = new Map<string, BlueprintGroup>();
    for (const file of inventory.files) {
      if (fileToGroup.has(file.fileId)) continue;

      if (plan.fallback?.strategy === "folder-category") {
        const fallbackId = this.fallbackGroupId(file.category);
        fileToGroup.set(file.fileId, fallbackId);
        fallbackAssignments.push({
          ...this.validationFileRef(file),
          fallbackGroupId: fallbackId,
        });
        const existing = fallbackGroups.get(fallbackId);
        if (existing) {
          existing.files.push(this.groupedFile(file));
        } else {
          fallbackGroups.set(fallbackId, {
            id: fallbackId,
            name: `Fallback ${file.category}`,
            description: `Files not matched by the LLM plan in category ${file.category}.`,
            kind: "fallback",
            files: [this.groupedFile(file)],
          });
        }
        continue;
      }

      unassignedFiles.push(this.validationFileRef(file));
    }

    const inventoryById = new Map(inventory.files.map((file) => [file.fileId, file]));
    const groups: BlueprintGroup[] = plan.groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      kind: group.kind,
      confidence: group.confidence,
      files: Array.from(planGroupFiles.get(group.id) ?? [])
        .filter((fileId) => fileToGroup.get(fileId) === group.id)
        .map((fileId) => inventoryById.get(fileId))
        .filter((file): file is FileInventory["files"][number] => Boolean(file))
        .map((file) => this.groupedFile(file))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }));

    groups.push(
      ...Array.from(fallbackGroups.values()).map((group) => ({
        ...group,
        files: group.files.sort((a, b) => a.path.localeCompare(b.path)),
      })),
    );

    const emptyGroups = groups
      .filter((group) => group.files.length === 0)
      .map((group) => group.id);
    const assignedFiles = new Set(fileToGroup.keys());
    const edges = this.aggregateEdges(facts, fileToGroup);
    const isAssignedCompletely =
      assignedFiles.size === inventory.files.length
      && unassignedFiles.length === 0
      && duplicateAssignments.length === 0;
    const blockingIssues = [
      ...(unassignedFiles.length > 0 ? ["unassignedFiles"] : []),
      ...(duplicateAssignments.length > 0 ? ["duplicateAssignments"] : []),
    ];
    const warningIssues = [
      ...(unknownPatterns.length > 0 ? ["unknownPatterns"] : []),
      ...(emptyGroups.length > 0 ? ["emptyGroups"] : []),
      ...(fallbackAssignments.length > 0 ? ["fallbackAssignments"] : []),
    ];
    const validation: GroupValidation = {
      isComplete: isAssignedCompletely,
      isAssignedCompletely,
      hasWarnings: warningIssues.length > 0,
      blockingIssues,
      warningIssues,
      inventoryFiles: inventory.files.length,
      assignedFiles: assignedFiles.size,
      unassignedFiles,
      duplicateAssignments,
      emptyGroups,
      unknownPatterns,
      fallbackAssignments,
    };

    return {
      analysisArtifactId,
      inventoryArtifactId: facts.inventoryArtifactId,
      project: {
        summary: plan.project?.summary?.trim() || this.fallbackProjectSummary(inventory, plan),
        purpose: plan.project?.purpose,
        architecture: plan.project?.architecture,
      },
      groups,
      crossGroupEdges: edges.crossGroupEdges,
      internalDependencyEdges: edges.internalDependencyEdges,
      validation,
    };
  }

  private matchingFileIds(
    inventory: FileInventory,
    pattern: string,
  ): Set<string> {
    return new Set(
      inventory.files
        .filter((file) => this.matchesPattern(file.path, pattern))
        .map((file) => file.fileId),
    );
  }

  private matchesPattern(path: string, pattern: string): boolean {
    if (path === pattern) return true;
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path.startsWith(prefix);
    }
    return this.patternToRegex(pattern).test(path);
  }

  private patternToRegex(pattern: string): RegExp {
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index];
      const next = pattern[index + 1];
      if (char === "*" && next === "*") {
        const after = pattern[index + 2];
        if (after === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
        continue;
      }
      if (char === "*") {
        source += "[^/]*";
        continue;
      }
      if (char === "?") {
        source += "[^/]";
        continue;
      }
      source += this.escapeRegex(char);
    }
    return new RegExp(`^${source}$`);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  private validationFileRef(file: FileInventory["files"][number]): ValidationFileRef {
    return {
      fileId: file.fileId,
      path: file.path,
      category: file.category,
      language: file.language,
    };
  }

  private groupedFile(file: FileInventory["files"][number]): GroupedFile {
    return {
      fileId: file.fileId,
      path: file.path,
      category: file.category,
      language: file.language,
      importance: "unknown",
      role: "unknown",
    };
  }

  private unknownPattern(inventory: FileInventory, pattern: string): UnknownPattern {
    return {
      pattern,
      reason: "matched no inventory files; the path may be ignored or not inventoried",
      suggestions: this.suggestPaths(inventory, pattern),
    };
  }

  private suggestPaths(inventory: FileInventory, pattern: string): string[] {
    const suffix = pattern
      .replaceAll("*", "")
      .replaceAll("?", "")
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (!suffix) return [];
    return inventory.files
      .map((file) => file.path)
      .filter((path) => path.includes(suffix))
      .slice(0, 5);
  }

  private fallbackGroupId(category: BlueprintFileCategory): string {
    return `fallback-${category}`;
  }

  private fallbackProjectSummary(inventory: FileInventory, plan: GroupingPlan): string {
    const groupNames = plan.groups.map((group) => group.name).sort();
    const stack = inventory.project.detectedStack.slice(0, 3).join(", ");
    const suffix = stack ? ` using ${stack}` : "";
    return `${inventory.project.name} is organized into ${groupNames.length} groups${suffix}: ${groupNames.join(", ")}.`;
  }

  private aggregateEdges(
    facts: AnalysisFacts,
    fileToGroup: Map<string, string>,
  ): { crossGroupEdges: GroupEdge[]; internalDependencyEdges: GroupEdge[] } {
    const cross = new Map<string, GroupEdge>();
    const internal = new Map<string, GroupEdge>();

    for (const dependency of facts.dependencies) {
      const fromGroupId = fileToGroup.get(dependency.fromFileId);
      const toGroupId = fileToGroup.get(dependency.toFileId);
      if (!fromGroupId || !toGroupId) continue;

      const target = fromGroupId === toGroupId ? internal : cross;
      const key = `${fromGroupId}:${toGroupId}:${dependency.type}`;
      const existing = target.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }

      target.set(key, {
        fromGroupId,
        toGroupId,
        type: dependency.type,
        count: 1,
      });
    }

    return {
      crossGroupEdges: this.sortEdges(Array.from(cross.values())),
      internalDependencyEdges: this.sortEdges(Array.from(internal.values())),
    };
  }

  private sortEdges(edges: GroupEdge[]): GroupEdge[] {
    return edges.sort((a, b) =>
      a.fromGroupId.localeCompare(b.fromGroupId)
      || a.toGroupId.localeCompare(b.toGroupId)
      || a.type.localeCompare(b.type),
    );
  }
}
