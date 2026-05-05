import { slugifyPathPart } from "../../lib/group-note-template.js";
import { type GroupingResult } from "../group/grouping.types.js";
import { type AnalysisFacts } from "../scan/scan-code-analysis-engine.js";
import { type FileInventory } from "../scan/scan-file-inventory-builder.js";
import { type BlueprintOutput, type BlueprintOutputValidation } from "./compose.types.js";
import { ComposeEntrypointDetector } from "./compose-entrypoint-detector.js";

export class ComposeOutputBuilder {
  constructor(
    private readonly entrypointDetector: ComposeEntrypointDetector,
  ) {}

  async build(
    grouping: GroupingResult,
    analysis?: AnalysisFacts,
    inventory?: FileInventory,
    language = "English",
  ): Promise<BlueprintOutput> {
    const validation = this.buildValidation(grouping);
    const entrypoints = await this.entrypointDetector.detect(inventory);

    return {
      schemaVersion: "blueprint.v1",
      project: {
        analysisArtifactId: grouping.analysisArtifactId,
        inventoryArtifactId: grouping.inventoryArtifactId,
        language,
        summary: grouping.project.summary,
        purpose: grouping.project.purpose,
        architecture: grouping.project.architecture,
      },
      groups: grouping.groups
        .map((group) => ({
          id: group.id,
          name: group.name,
          kind: group.kind,
          summary: group.description,
          docsPath: this.groupDocsPath(group.id),
          fileIds: group.files.map((file) => file.fileId).sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      files: grouping.groups
        .flatMap((group) =>
          group.files.map((file) => ({
            id: file.fileId,
            path: file.path,
            groupId: group.id,
            category: file.category,
            language: file.language,
            notesStatus: "not-required" as const,
            role: file.role && file.role !== "unknown" ? file.role : undefined,
          })),
        )
        .sort((a, b) => a.path.localeCompare(b.path)),
      edges: [...grouping.crossGroupEdges]
        .sort((a, b) =>
          a.fromGroupId.localeCompare(b.fromGroupId)
          || a.toGroupId.localeCompare(b.toGroupId)
          || a.type.localeCompare(b.type),
        ),
      fileEdges: this.composeFileEdges(grouping, analysis),
      symbols: this.composeSymbols(grouping, analysis),
      entrypoints,
      testLinks: this.composeTestLinks(grouping, analysis),
      validation,
    };
  }

  private filePathById(grouping: GroupingResult): Map<string, string> {
    return new Map(
      grouping.groups.flatMap((group) =>
        group.files.map((file) => [file.fileId, file.path] as const),
      ),
    );
  }

  private composeFileEdges(
    grouping: GroupingResult,
    analysis?: AnalysisFacts,
  ): BlueprintOutput["fileEdges"] {
    if (!analysis) return [];

    const paths = this.filePathById(grouping);
    return analysis.dependencies
      .map((edge) => {
        const fromPath = paths.get(edge.fromFileId);
        const toPath = paths.get(edge.toFileId);
        if (!fromPath || !toPath) return undefined;
        return {
          fromFileId: edge.fromFileId,
          toFileId: edge.toFileId,
          fromPath,
          toPath,
          type: edge.type,
          symbols: [...edge.symbols].sort(),
        };
      })
      .filter((edge): edge is BlueprintOutput["fileEdges"][number] => Boolean(edge))
      .sort((a, b) =>
        a.fromPath.localeCompare(b.fromPath)
        || a.toPath.localeCompare(b.toPath)
        || a.type.localeCompare(b.type),
      );
  }

  private exportedSymbolIds(analysis: AnalysisFacts): Set<string> {
    const exportedByFile = new Map<string, Set<string>>();
    for (const exp of analysis.exports) {
      const names = exportedByFile.get(exp.fileId) ?? new Set<string>();
      for (const symbol of exp.exportedSymbols) names.add(symbol);
      exportedByFile.set(exp.fileId, names);
    }

    return new Set(
      Object.values(analysis.symbols)
        .filter((symbol) => exportedByFile.get(symbol.fileId)?.has(symbol.name))
        .map((symbol) => symbol.symbolId),
    );
  }

  private composeSymbols(
    grouping: GroupingResult,
    analysis?: AnalysisFacts,
  ): BlueprintOutput["symbols"] {
    if (!analysis) return [];

    const paths = this.filePathById(grouping);
    const exported = this.exportedSymbolIds(analysis);
    return Object.values(analysis.symbols)
      .filter((symbol) => paths.has(symbol.fileId))
      .map((symbol) => ({
        id: symbol.symbolId,
        fileId: symbol.fileId,
        path: paths.get(symbol.fileId) ?? symbol.fileId,
        name: symbol.name,
        kind: symbol.kind,
        signature: symbol.signature,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        exported: exported.has(symbol.symbolId),
      }))
      .sort((a, b) =>
        a.path.localeCompare(b.path)
        || Number(b.exported) - Number(a.exported)
        || a.name.localeCompare(b.name),
      );
  }

  private composeTestLinks(
    grouping: GroupingResult,
    analysis?: AnalysisFacts,
  ): BlueprintOutput["testLinks"] {
    if (!analysis) return [];

    const paths = this.filePathById(grouping);
    const files = grouping.groups.flatMap((group) => group.files);
    const testFileIds = new Set(
      files
        .filter((file) => file.category === "test" || this.isTestPath(file.path))
        .map((file) => file.fileId),
    );
    const links = new Map<string, BlueprintOutput["testLinks"][number]>();

    for (const dependency of analysis.dependencies) {
      if (!testFileIds.has(dependency.fromFileId)) continue;
      const sourcePath = paths.get(dependency.toFileId);
      const testPath = paths.get(dependency.fromFileId);
      if (!sourcePath || !testPath) continue;

      const reasons = ["imports-source"];
      if (this.isNameMatch(sourcePath, testPath)) reasons.push("name-match");
      const confidence = reasons.includes("name-match") ? 0.95 : 0.85;
      links.set(`${dependency.toFileId}:${dependency.fromFileId}`, {
        sourceFileId: dependency.toFileId,
        sourcePath,
        testFileId: dependency.fromFileId,
        testPath,
        confidence,
        reasons,
      });
    }

    for (const testFileId of testFileIds) {
      const testPath = paths.get(testFileId);
      if (!testPath) continue;
      for (const file of files) {
        if (file.fileId === testFileId || file.category === "test") continue;
        if (!this.isNameMatch(file.path, testPath)) continue;
        const key = `${file.fileId}:${testFileId}`;
        if (links.has(key)) continue;
        links.set(key, {
          sourceFileId: file.fileId,
          sourcePath: file.path,
          testFileId,
          testPath,
          confidence: 0.7,
          reasons: ["name-match"],
        });
      }
    }

    return Array.from(links.values())
      .map((link) => ({
        ...link,
        reasons: [...link.reasons].sort(),
      }))
      .sort((a, b) =>
        a.sourcePath.localeCompare(b.sourcePath)
        || a.testPath.localeCompare(b.testPath),
      );
  }

  private groupDocsPath(groupId: string): string {
    return `blueprint/groups/${slugifyPathPart(groupId)}.md`;
  }

  private isTestPath(path: string): boolean {
    return /(^|\/)(tests?|__tests__)\//.test(path)
      || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
  }

  private isNameMatch(sourcePath: string, testPath: string): boolean {
    return this.normalizedStem(sourcePath) === this.normalizedStem(testPath);
  }

  private normalizedStem(path: string): string {
    const filename = path.split("/").at(-1) ?? path;
    return filename
      .replace(/\.(test|spec)(?=\.)/, "")
      .replace(/\.[^.]+$/, "");
  }

  private buildValidation(grouping: GroupingResult): BlueprintOutputValidation {
    return {
      isValid: grouping.validation.isComplete,
      groupingComplete: grouping.validation.isComplete,
      groupingIssueSummary: grouping.validation.blockingIssues,
      groupingWarningSummary: grouping.validation.warningIssues,
    };
  }
}
