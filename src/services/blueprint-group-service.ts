import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { blueprintOutputReadCandidates } from "../lib/blueprint-paths.js";
import { readGroupDoc } from "../lib/group-docs.js";
import type { ParsedGroupDoc } from "../lib/group-docs.js";
import type { BlueprintOutput } from "../tools/compose/compose.types.js";

type ConnectionDirection = "incoming" | "outgoing";
type DocsStatus = "ready" | "draft" | "missing" | "unknown";
type BlueprintFileWithOptionalSummary = BlueprintOutput["files"][number] & {
  summary?: string;
};

interface GroupConnection {
  groupId: string;
  groupName: string;
  direction: ConnectionDirection;
  type: string;
  count: number;
}

interface GroupDocPayload {
  exists: boolean;
  frontmatter: Record<string, string>;
  sections: Record<string, string>;
  validation: {
    warnings: string[];
  };
}

export type BlueprintGroupsResult =
  | {
    ok: true;
    payload: {
      schemaVersion: string;
      groups: Array<{
        id: string;
        name: string;
        kind?: string;
        summary?: string;
        fileCount: number;
        docsStatus: DocsStatus;
        connections: GroupConnection[];
      }>;
      totals: {
        groups: number;
        files: number;
        edges: number;
      };
      validation: {
        isValid: boolean;
        warnings: string[];
      };
    };
  }
  | {
    ok: false;
    reason: "blueprint-output-missing";
    message: string;
  };

export type BlueprintGroupDetailResult =
  | {
    ok: true;
    payload: {
      group: {
        id: string;
        name: string;
        kind?: string;
        summary?: string;
        fileCount: number;
        docsPath?: string;
      };
      doc: GroupDocPayload;
      files: Array<{
        id: string;
        path: string;
        category: string;
        language: string;
        summary?: string;
        role?: string;
      }>;
      connections: GroupConnection[];
    };
  }
  | {
    ok: false;
    reason: "blueprint-output-missing" | "group-not-found" | "forbidden";
    message: string;
    groupId?: string;
  };

export class BlueprintGroupService {
  async list(projectRoot: string): Promise<BlueprintGroupsResult> {
    const root = resolve(projectRoot);
    const blueprint = await this.readBlueprintOutput(root);
    if (!blueprint) {
      return {
        ok: false,
        reason: "blueprint-output-missing",
        message: "blueprint-output.json was not found",
      };
    }

    const docsStatuses = await this.buildDocsStatuses(root, blueprint);

    return {
      ok: true,
      payload: {
        schemaVersion: blueprint.schemaVersion,
        groups: blueprint.groups.map((group) => ({
          id: group.id,
          name: group.name,
          ...(group.kind ? { kind: group.kind } : {}),
          ...(group.summary ? { summary: group.summary } : {}),
          fileCount: group.fileIds.length,
          docsStatus: docsStatuses.get(group.id) ?? "unknown",
          connections: this.connectionsForGroup(blueprint, group.id),
        })),
        totals: {
          groups: blueprint.groups.length,
          files: blueprint.files.length,
          edges: blueprint.edges.length,
        },
        validation: {
          isValid: blueprint.validation.isValid,
          warnings: blueprint.validation.groupingWarningSummary,
        },
      },
    };
  }

  async detail(
    projectRoot: string,
    groupId: string,
  ): Promise<BlueprintGroupDetailResult> {
    const root = resolve(projectRoot);
    const blueprint = await this.readBlueprintOutput(root);
    if (!blueprint) {
      return {
        ok: false,
        reason: "blueprint-output-missing",
        message: "blueprint-output.json was not found",
      };
    }

    const group = blueprint.groups.find((candidate) => candidate.id === groupId);
    if (!group) {
      return {
        ok: false,
        reason: "group-not-found",
        message: "group not found",
        groupId,
      };
    }

    const docResult = await this.readGroupDocForGroup(root, group.docsPath);
    if (docResult.reason === "forbidden") {
      return {
        ok: false,
        reason: "forbidden",
        message: "forbidden",
        groupId,
      };
    }

    const filesById = new Map(
      blueprint.files.map((file) => [file.id, file as BlueprintFileWithOptionalSummary]),
    );

    return {
      ok: true,
      payload: {
        group: {
          id: group.id,
          name: group.name,
          ...(group.kind ? { kind: group.kind } : {}),
          ...(group.summary ? { summary: group.summary } : {}),
          fileCount: group.fileIds.length,
          ...(group.docsPath ? { docsPath: group.docsPath } : {}),
        },
        doc: docResult.doc,
        files: group.fileIds
          .map((fileId) => filesById.get(fileId))
          .filter((file): file is BlueprintFileWithOptionalSummary => Boolean(file))
          .map((file) => ({
            id: file.id,
            path: file.path,
            category: file.category,
            language: file.language,
            ...(file.summary ? { summary: file.summary } : {}),
            ...(file.role ? { role: file.role } : {}),
          })),
        connections: this.connectionsForGroup(blueprint, group.id),
      },
    };
  }

  private async buildDocsStatuses(
    root: string,
    blueprint: BlueprintOutput,
  ): Promise<Map<string, DocsStatus>> {
    const statuses = new Map<string, DocsStatus>();
    await Promise.all(blueprint.groups.map(async (group) => {
      const docResult = await this.readGroupDocForGroup(root, group.docsPath);
      statuses.set(group.id, this.docsStatus(docResult.doc));
    }));
    return statuses;
  }

  private async readGroupDocForGroup(
    root: string,
    docsPath: string,
  ): Promise<{
    reason?: "forbidden";
    doc: GroupDocPayload;
  }> {
    const resolvedDocsPath = resolve(root, docsPath);
    if (!this.isPathInside(root, resolvedDocsPath)) {
      return {
        reason: "forbidden",
        doc: this.missingDoc("forbidden"),
      };
    }

    try {
      return {
        doc: this.docFromParsed(await readGroupDoc(resolvedDocsPath)),
      };
    } catch {
      return {
        doc: this.missingDoc("group docs not found"),
      };
    }
  }

  private docFromParsed(parsed: ParsedGroupDoc): GroupDocPayload {
    return {
      exists: true,
      frontmatter: parsed.frontmatter,
      sections: Object.fromEntries(
        parsed.sections.map((section) => [
          this.sectionKey(section.heading),
          section.content,
        ]),
      ),
      validation: {
        warnings: parsed.validation.warnings,
      },
    };
  }

  private missingDoc(warning: string): GroupDocPayload {
    return {
      exists: false,
      frontmatter: {},
      sections: {},
      validation: {
        warnings: [warning],
      },
    };
  }

  private docsStatus(doc: {
    exists: boolean;
    frontmatter: Record<string, string>;
  }): DocsStatus {
    if (!doc.exists) return "missing";
    if (doc.frontmatter.status === "ready") return "ready";
    if (doc.frontmatter.status === "draft") return "draft";
    return "unknown";
  }

  private connectionsForGroup(
    blueprint: BlueprintOutput,
    groupId: string,
  ): GroupConnection[] {
    const groupsById = new Map(blueprint.groups.map((group) => [group.id, group]));

    return blueprint.edges
      .flatMap((edge): GroupConnection[] => {
        if (edge.fromGroupId === groupId) {
          const target = groupsById.get(edge.toGroupId);
          return [{
            groupId: edge.toGroupId,
            groupName: target?.name ?? edge.toGroupId,
            direction: "outgoing",
            type: edge.type,
            count: edge.count,
          }];
        }
        if (edge.toGroupId === groupId) {
          const source = groupsById.get(edge.fromGroupId);
          return [{
            groupId: edge.fromGroupId,
            groupName: source?.name ?? edge.fromGroupId,
            direction: "incoming",
            type: edge.type,
            count: edge.count,
          }];
        }
        return [];
      })
      .sort((a, b) =>
        a.groupName.localeCompare(b.groupName)
        || a.direction.localeCompare(b.direction)
        || a.type.localeCompare(b.type),
      );
  }

  private sectionKey(heading: string): string {
    return heading
      .replace(/&/g, " and ")
      .replace(/\//g, " ")
      .replace(/[^A-Za-z0-9]+(.)/g, (_, char: string) => char.toUpperCase())
      .replace(/^[A-Z]/, (char) => char.toLowerCase());
  }

  private async readBlueprintOutput(projectRoot: string): Promise<BlueprintOutput | undefined> {
    for (const path of blueprintOutputReadCandidates(projectRoot)) {
      try {
        return JSON.parse(await readFile(path, "utf-8")) as BlueprintOutput;
      } catch {
        // Try the next supported output location.
      }
    }
    return undefined;
  }

  private isPathInside(rootPath: string, candidatePath: string): boolean {
    const rel = relative(rootPath, candidatePath);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }
}
