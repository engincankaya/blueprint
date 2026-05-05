/**
 * Blueprint grouping stage.
 *
 * `blueprint.group` has two modes:
 * - prepare: build a compact, token-safe packet that helps the LLM create a
 *   semantic grouping plan.
 * - apply: validate the LLM-authored grouping plan, resolve glob patterns
 *   deterministically, assign every inventory file, and store grouped files and
 *   group-level dependency edges.
 */
import { type ArtifactStore } from "../../lib/artifact-store.js";
import { type ToolResult, errorResult, jsonResult } from "../../types.js";
import {
  type AnalysisFacts,
} from "../scan/scan-code-analysis-engine.js";
import {
  type BlueprintFileCategory,
  type FileInventory,
} from "../scan/scan-file-inventory-builder.js";
import { GroupingAssignmentEngine } from "./grouping-assignment-engine.js";
import { GroupingPlanValidator } from "./grouping-plan-validator.js";
import {
  type GroupingPlan,
} from "./grouping.types.js";

interface GroupToolInput {
  mode: "prepare" | "apply";
  analysisArtifactId: string;
  plan?: unknown;
}

interface GroupingPacket {
  project: {
    name: string;
    detectedStack: string[];
    packageManagers: string[];
    requiredPlanFields: string[];
  };
  constraints: {
    preferredGroupCount: string;
    maxGroupCount: number;
    eachFileExactlyOneGroup: boolean;
  };
  assignmentRules: {
    preferGlobPatterns: boolean;
    avoidListingEveryFile: boolean;
    globExamples: string[];
    exactPathUseCases: string[];
    requiredPlanFields: string[];
    fallbackStrategy: "folder-category";
    onlyUsePathsSeenInInventory: boolean;
    inventoryBoundaryNote: string;
    avoidPatternExamples: string[];
  };
  inventorySummary: FileInventory["summary"];
  folderSignals: FolderSignal[];
  importantFiles: ImportantFileSignal[];
  dependencyHints: DependencyHint[];
}

interface GroupPrepareValidation {
  isValid: boolean;
  estimatedTokens: number;
  maxEstimatedTokens: number;
  missingFields: string[];
  hasFullFileDump: boolean;
  folderSignals: number;
  importantFiles: number;
  dependencyHints: number;
}

interface FolderSignal {
  pattern: string;
  fileCount: number;
  categories: Partial<Record<BlueprintFileCategory, number>>;
  languages: Record<string, number>;
  topExports: string[];
  score: number;
}

interface ImportantFileSignal {
  fileId: string;
  path: string;
  exports: string[];
  symbolCount: number;
  incomingDependencies: number;
  outgoingDependencies: number;
}

interface DependencyHint {
  from: string;
  to: string;
  type: string;
  symbols: string[];
}

interface DependencyCounts {
  incoming: Map<string, number>;
  outgoing: Map<string, number>;
}

interface DependencyHintCandidate {
  hint: DependencyHint;
  fromFolder: string;
  toFolder: string;
  crossFolder: boolean;
  score: number;
}

export class GroupTool {
  constructor(
    private readonly planValidator: GroupingPlanValidator,
    private readonly assignmentEngine: GroupingAssignmentEngine,
  ) {}

  async handle(args: GroupToolInput, store: ArtifactStore): Promise<ToolResult> {
    const facts = this.getAnalysisFacts(args.analysisArtifactId, store);
    if (!facts) {
      const entry = store.get(args.analysisArtifactId);
      return errorResult(
        entry
          ? `Analysis artifact ${args.analysisArtifactId} not found or has the wrong type`
          : `Analysis artifact ${args.analysisArtifactId} not found`,
      );
    }

    const inventory = this.getInventory(facts, store);
    if (!inventory) {
      return errorResult(
        `File inventory artifact ${facts.inventoryArtifactId} not found or has the wrong type`,
      );
    }

    if (args.mode === "prepare") {
      return this.prepare(args, inventory, facts);
    }

    return this.apply(args, store, inventory, facts);
  }

  private prepare(
    args: GroupToolInput,
    inventory: FileInventory,
    facts: AnalysisFacts,
  ): ToolResult {
    const packet = this.buildPreparePacket(inventory, facts);
    return jsonResult({
      mode: "prepare",
      validation: this.validatePreparePacket(packet),
      packet,
      next: {
        prompt: "blueprint-create-grouping-plan",
        inputMap: {
          groupPreparePacketJson: "$.packet",
        },
        then: {
          tool: "blueprint.group",
          mode: "apply",
          analysisArtifactId: args.analysisArtifactId,
        },
      },
    });
  }

  private apply(
    args: GroupToolInput,
    store: ArtifactStore,
    inventory: FileInventory,
    facts: AnalysisFacts,
  ): ToolResult {
    if (!args.plan) {
      return errorResult("blueprint.group apply mode requires a plan");
    }

    const normalized = this.planValidator.normalize(args.plan);
    if (normalized.error) {
      return errorResult(normalized.error);
    }

    const planErrors = this.planValidator.validate(normalized.plan);
    if (planErrors.length > 0) {
      return errorResult(`Invalid GroupingPlan: ${planErrors.join("; ")}`);
    }

    const result = this.assignmentEngine.apply(
      args.analysisArtifactId,
      inventory,
      facts,
      normalized.plan as GroupingPlan,
    );
    const artifactId = store.put(
      "groupingResult",
      result,
      `${result.groups.length} groups, ${result.validation.assignedFiles}/${result.validation.inventoryFiles} files assigned`,
    );

    return jsonResult({
      mode: "apply",
      artifactId,
      summary: {
        groups: result.groups.length,
        files: result.validation.assignedFiles,
        crossGroupEdges: result.crossGroupEdges.length,
        internalDependencyEdges: result.internalDependencyEdges.length,
      },
      validation: result.validation,
      next: {
        tool: "blueprint.compose",
        input: {
          groupingArtifactId: artifactId,
        },
      },
    });
  }

  private getAnalysisFacts(
    analysisArtifactId: string,
    store: ArtifactStore,
  ): AnalysisFacts | undefined {
    return store.getTyped<AnalysisFacts>(analysisArtifactId, "analysisFacts");
  }

  private getInventory(
    facts: AnalysisFacts,
    store: ArtifactStore,
  ): FileInventory | undefined {
    return store.getTyped<FileInventory>(facts.inventoryArtifactId, "fileInventory");
  }

  private buildPreparePacket(
    inventory: FileInventory,
    facts: AnalysisFacts,
  ): GroupingPacket {
    return {
      project: {
        name: inventory.project.name,
        detectedStack: inventory.project.detectedStack,
        packageManagers: inventory.project.packageManagers,
        requiredPlanFields: ["project.summary", "groups[].id", "groups[].name", "groups[].include"],
      },
      constraints: {
        preferredGroupCount: "5-8",
        maxGroupCount: 12,
        eachFileExactlyOneGroup: true,
      },
      assignmentRules: {
        preferGlobPatterns: true,
        avoidListingEveryFile: true,
        globExamples: this.buildGlobExamples(inventory),
        exactPathUseCases: ["entrypoints", "exceptions", "cross-cutting-files"],
        requiredPlanFields: ["project.summary", "groups[].id", "groups[].name", "groups[].include"],
        fallbackStrategy: "folder-category",
        onlyUsePathsSeenInInventory: true,
        inventoryBoundaryNote: "Only use paths present in the inventory packet.",
        avoidPatternExamples: ["node_modules/**", "*.json"],
      },
      inventorySummary: inventory.summary,
      folderSignals: this.buildFolderSignals(inventory, facts),
      importantFiles: this.buildImportantFiles(facts),
      dependencyHints: this.buildDependencyHints(facts),
    };
  }

  private validatePreparePacket(packet: GroupingPacket): GroupPrepareValidation {
    const requiredFields: Array<[string, unknown]> = [
      ["project", packet.project],
      ["constraints", packet.constraints],
      ["assignmentRules", packet.assignmentRules],
      ["inventorySummary", packet.inventorySummary],
      ["folderSignals", packet.folderSignals],
      ["importantFiles", packet.importantFiles],
      ["dependencyHints", packet.dependencyHints],
    ];
    const missingFields = requiredFields
      .filter(([, value]) => !this.hasValue(value))
      .map(([field]) => field);
    const packetAsRecord = packet as unknown as Record<string, unknown>;
    const hasFullFileDump = "files" in packetAsRecord || "allFiles" in packetAsRecord;
    const maxEstimatedTokens = 6000;
    const estimatedTokens = this.estimateTokens(packet);

    return {
      isValid:
        missingFields.length === 0
        && !hasFullFileDump
        && estimatedTokens <= maxEstimatedTokens,
      estimatedTokens,
      maxEstimatedTokens,
      missingFields,
      hasFullFileDump,
      folderSignals: packet.folderSignals.length,
      importantFiles: packet.importantFiles.length,
      dependencyHints: packet.dependencyHints.length,
    };
  }

  private increment<T extends string>(counts: Partial<Record<T, number>>, key: T): void {
    counts[key] = (counts[key] ?? 0) + 1;
  }

  private folderPatterns(path: string): string[] {
    const parts = path.split("/");
    if (parts.length === 1) return ["root/**"];
    const patterns = new Set<string>();
    const maxDepth = Math.min(parts.length - 1, 4);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      patterns.add(`${parts.slice(0, depth).join("/")}/**`);
    }
    return Array.from(patterns);
  }

  private dependencyCounts(facts: AnalysisFacts): DependencyCounts {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const dependency of facts.dependencies) {
      incoming.set(
        dependency.toFileId,
        (incoming.get(dependency.toFileId) ?? 0) + 1,
      );
      outgoing.set(
        dependency.fromFileId,
        (outgoing.get(dependency.fromFileId) ?? 0) + 1,
      );
    }
    return { incoming, outgoing };
  }

  private buildFolderSignals(
    inventory: FileInventory,
    facts: AnalysisFacts,
  ): FolderSignal[] {
    const grouped = new Map<string, FileInventory["files"]>();
    for (const file of inventory.files) {
      for (const pattern of this.folderPatterns(file.path)) {
        grouped.set(pattern, [...(grouped.get(pattern) ?? []), file]);
      }
    }
    const { incoming, outgoing } = this.dependencyCounts(facts);

    return Array.from(grouped.entries())
      .map(([pattern, files]) => {
        const categories: Partial<Record<BlueprintFileCategory, number>> = {};
        const languages: Record<string, number> = {};
        const fileIds = new Set(files.map((file) => file.fileId));
        const topExports = facts.exports
          .filter((exp) => fileIds.has(exp.fileId))
          .flatMap((exp) => exp.exportedSymbols)
          .slice(0, 8);

        for (const file of files) {
          this.increment(categories, file.category);
          this.increment(languages, file.language);
        }
        const dependencyScore = files.reduce(
          (sum, file) =>
            sum + (incoming.get(file.fileId) ?? 0) + (outgoing.get(file.fileId) ?? 0),
          0,
        );
        const categoryDiversity = Object.keys(categories).length;
        const entrypointBonus = files.some((file) =>
          /(^|\/)(index|main|app|server)\.[cm]?[jt]sx?$/.test(file.path),
        ) ? 3 : 0;
        const score =
          files.length
          + topExports.length * 2
          + dependencyScore * 3
          + categoryDiversity
          + entrypointBonus;

        return {
          pattern,
          fileCount: files.length,
          categories,
          languages,
          topExports,
          score,
        };
      })
      .sort((a, b) => b.score - a.score || a.pattern.localeCompare(b.pattern))
      .slice(0, 20);
  }

  private buildImportantFiles(facts: AnalysisFacts): ImportantFileSignal[] {
    const { incoming, outgoing } = this.dependencyCounts(facts);

    return Object.values(facts.files)
      .map((file) => ({
        fileId: file.fileId,
        path: file.path,
        exports: file.exports,
        symbolCount: file.symbols.length,
        incomingDependencies: incoming.get(file.fileId) ?? 0,
        outgoingDependencies: outgoing.get(file.fileId) ?? 0,
      }))
      .filter((file) =>
        file.exports.length > 0
        || file.incomingDependencies > 0
        || file.outgoingDependencies > 0,
      )
      .sort((a, b) => {
        const scoreA = this.scoreImportantFile(a);
        const scoreB = this.scoreImportantFile(b);
        return scoreB - scoreA || a.path.localeCompare(b.path);
      })
      .slice(0, 20);
  }

  private scoreImportantFile(file: ImportantFileSignal): number {
    const directToolBonus = /(^|\/)mcp-server\/src\/tools\/(?:[^/]+\.ts|[^/]+\/index\.ts)$/.test(file.path)
      ? 6
      : 0;
    const exportedHandlerBonus = file.exports.some((name) => /^handle[A-Z]/.test(name))
      ? 5
      : 0;
    const centralTypeBonus = file.exports.some((name) =>
      /(Result|Args|Input|Output|Store|Tool|Blueprint|Plan)$/.test(name),
    )
      ? 2
      : 0;

    return file.exports.length * 2
      + file.symbolCount
      + file.incomingDependencies * 3
      + file.outgoingDependencies * 2
      + directToolBonus
      + exportedHandlerBonus
      + centralTypeBonus;
  }

  private folderOfPath(path: string): string {
    return path.split("/").slice(0, -1).join("/");
  }

  private buildDependencyHints(facts: AnalysisFacts): DependencyHint[] {
    const { incoming, outgoing } = this.dependencyCounts(facts);
    const candidates = facts.dependencies
      .map((dependency): DependencyHintCandidate => {
        const from = facts.files[dependency.fromFileId]?.path ?? dependency.fromFileId;
        const to = facts.files[dependency.toFileId]?.path ?? dependency.toFileId;
        const incomingCount = incoming.get(dependency.toFileId) ?? 0;
        const outgoingCount = outgoing.get(dependency.fromFileId) ?? 0;
        const fromFolder = this.folderOfPath(from);
        const toFolder = this.folderOfPath(to);
        const crossFolder = fromFolder !== toFolder;
        const score = incomingCount * 4 + outgoingCount * 2 + (crossFolder ? 3 : 0);
        return {
          hint: {
            from,
            to,
            type: dependency.type,
            symbols: dependency.symbols,
          },
          fromFolder,
          toFolder,
          crossFolder,
          score,
        };
      })
      .sort((a, b) =>
        Number(b.crossFolder) - Number(a.crossFolder)
        || b.score - a.score
        || a.hint.from.localeCompare(b.hint.from)
        || a.hint.to.localeCompare(b.hint.to),
      );

    const selected: DependencyHint[] = [];
    const pairCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();

    for (const candidate of candidates.filter((item) => item.crossFolder)) {
      this.addDependencyHintCandidate(candidate, selected, pairCounts, targetCounts);
      if (selected.length >= 20) break;
    }

    if (selected.length >= 20) return selected;

    for (const candidate of candidates.filter((item) => !item.crossFolder)) {
      if (selected.some((hint) =>
        hint.from === candidate.hint.from && hint.to === candidate.hint.to,
      )) {
        continue;
      }
      this.addDependencyHintCandidate(candidate, selected, pairCounts, targetCounts);
      if (selected.length >= 20) break;
    }

    return selected;
  }

  private addDependencyHintCandidate(
    candidate: DependencyHintCandidate,
    selected: DependencyHint[],
    pairCounts: Map<string, number>,
    targetCounts: Map<string, number>,
  ): void {
    const pairKey = `${candidate.fromFolder}->${candidate.toFolder}`;
    const pairCount = pairCounts.get(pairKey) ?? 0;
    const targetCount = targetCounts.get(candidate.hint.to) ?? 0;
    if (pairCount >= 2 || targetCount >= 2) return;

    selected.push(candidate.hint);
    pairCounts.set(pairKey, pairCount + 1);
    targetCounts.set(candidate.hint.to, targetCount + 1);
  }

  private buildGlobExamples(inventory: FileInventory): string[] {
    const examples = inventory.summary.topLevelDirs.map((dir) => `${dir}/**`);
    return examples.length > 0 ? examples : ["src/**"];
  }

  private hasValue(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object" && value !== null) {
      return Object.keys(value).length > 0;
    }
    return value !== undefined && value !== null && value !== "";
  }

  private estimateTokens(value: unknown): number {
    return Math.ceil(JSON.stringify(value).length / 4);
  }
}
