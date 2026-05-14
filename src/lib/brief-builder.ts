import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  blueprintOutputPath,
  briefPath as resolveBriefPath,
} from "./blueprint-paths.js";
import { type BlueprintOutput } from "../tools/compose/compose.types.js";

interface ProjectBriefResult {
  status: "ready" | "missing";
  briefPath: string;
  warnings: string[];
}

export async function ensureProjectBrief(projectRoot: string): Promise<ProjectBriefResult> {
  const root = resolve(projectRoot);
  const blueprintPath = blueprintOutputPath(root);
  const briefPath = resolveBriefPath(root);
  const blueprint = await readBlueprintOutput(blueprintPath);

  if (!blueprint) {
    return {
      status: "missing",
      briefPath,
      warnings: ["blueprint-output.json was not found; no project brief was generated."],
    };
  }

  await mkdir(dirname(briefPath), { recursive: true });
  await writeProjectBrief(briefPath, blueprint);
  return {
    status: "ready",
    briefPath,
    warnings: [],
  };
}

export async function writeProjectBrief(
  briefPath: string,
  blueprint: BlueprintOutput,
): Promise<void> {
  await mkdir(dirname(briefPath), { recursive: true });
  await writeFile(briefPath, await renderProjectBrief(briefPath, blueprint), "utf-8");
}

async function renderProjectBrief(
  briefPath: string,
  blueprint: BlueprintOutput,
): Promise<string> {
  const filesById = new Map(blueprint.files.map((file) => [file.id, file]));
  const symbolsByFileId = groupBy(blueprint.symbols, (symbol) => symbol.fileId);
  const entrypointsByGroupId = new Map<string, BlueprintOutput["entrypoints"]>();
  const filesByPath = new Map(blueprint.files.map((file) => [file.path, file]));
  for (const entrypoint of blueprint.entrypoints) {
    const file = filesByPath.get(entrypoint.path) ?? filesByPath.get(entrypoint.registrationPath);
    if (!file) continue;
    entrypointsByGroupId.set(file.groupId, [
      ...(entrypointsByGroupId.get(file.groupId) ?? []),
      entrypoint,
    ]);
  }

  const lines: string[] = [
    "# Project Blueprint Brief",
    "",
    "Compact routing index for agents. Use it to pick the smallest useful context before reading source files.",
    "",
    "## Agent Rules",
    "",
    "- Start here, then read only the relevant group markdowns.",
    "- Group markdowns are memory; source files are ground truth.",
    "- Read source files only after the relevant group docs are insufficient or code changes are required.",
    "- If docs conflict with source, trust source and update memory after the task.",
    "",
    "## Project Status",
    "",
    `- schema: ${blueprint.schemaVersion}`,
    "",
    "## Project Overview",
    "",
    `- summary: ${blueprint.project.summary ?? "not documented"}`,
    ...(blueprint.project.purpose ? [`- purpose: ${blueprint.project.purpose}`] : []),
    ...(blueprint.project.architecture ? [`- architecture: ${blueprint.project.architecture}`] : []),
    "",
    "## How To Route A Task",
    "",
    "1. Match the user request against each card's `read when` hints.",
    "2. Read the docs for the 1-3 most relevant groups.",
    "3. Use `start files` only when source inspection or edits are needed.",
    "4. Follow `related` when the task crosses a boundary.",
    "",
    "## Group Index",
    "",
  ];

  for (const group of blueprint.groups) {
    const groupFiles = group.fileIds
      .map((fileId) => filesById.get(fileId))
      .filter((file): file is BlueprintOutput["files"][number] => Boolean(file));
    const folders = collectFolders(groupFiles).slice(0, 6);
    const entrypoints = entrypointsByGroupId.get(group.id) ?? [];
    const keyFiles = selectKeyFiles(groupFiles, entrypoints, 5);
    const routingHints = buildRoutingHints(group, groupFiles, entrypoints, symbolsByFileId);
    const relatedGroups = collectRelatedGroups(blueprint, group.id);

    lines.push(`### ${group.name}`);
    lines.push(`- id: ${group.id}; kind: ${group.kind ?? "unknown"}; files: ${group.fileIds.length}; folders: ${folders.length > 0 ? folders.join(", ") : "none"}`);
    if (group.summary) {
      lines.push(`- summary: ${group.summary}`);
    }
    lines.push(`- read when: ${routingHints.join(", ")}`);
    lines.push(`- docs: \`${group.docsPath}\``);
    lines.push(`- start files: ${keyFiles.map(formatKeyFileInline).join("; ") || "none"}`);
    if (entrypoints.length > 0) {
      lines.push(`- entrypoints: ${entrypoints.map((entrypoint) => `${entrypoint.name} -> ${entrypoint.path}`).join("; ")}`);
    }
    if (relatedGroups.length > 0) {
      lines.push(`- related: ${relatedGroups.join("; ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatKeyFileInline(file: BlueprintOutput["files"][number]): string {
  const role = file.role ?? file.category;
  return `${file.path} - ${role}`;
}

function selectKeyFiles(
  files: BlueprintOutput["files"],
  entrypoints: BlueprintOutput["entrypoints"] = [],
  limit = 8,
): BlueprintOutput["files"] {
  const entrypointPaths = new Set(entrypoints.map((entrypoint) => entrypoint.path));
  return [...files]
    .sort(
      (left, right) =>
        fileRank(right, entrypointPaths) - fileRank(left, entrypointPaths)
        || left.path.localeCompare(right.path),
    )
    .slice(0, limit);
}

function fileRank(
  file: BlueprintOutput["files"][number],
  entrypointPaths: Set<string>,
): number {
  let rank = 0;
  if (entrypointPaths.has(file.path)) rank += 30;
  if (file.role === "entrypoint") rank += 20;
  if (file.category === "source") rank += 10;
  if (file.category === "test") rank -= 5;
  return rank;
}

function collectFolders(files: BlueprintOutput["files"]): string[] {
  const folders = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    if (segments.length > 1) {
      folders.add(segments.slice(0, -1).join("/"));
    }
  }
  return Array.from(folders).sort();
}

function buildRoutingHints(
  group: BlueprintOutput["groups"][number],
  files: BlueprintOutput["files"],
  entrypoints: BlueprintOutput["entrypoints"],
  symbolsByFileId: Map<string, BlueprintOutput["symbols"]>,
  limit = 14,
): string[] {
  const weightedTokens = new Map<string, number>();

  addWeightedTokens(weightedTokens, group.name, 10);
  addWeightedTokens(weightedTokens, group.id, 8);
  addWeightedTokens(weightedTokens, group.kind ?? "", 5);
  addWeightedTokens(weightedTokens, group.summary ?? "", 6);
  addWeightedTokens(weightedTokens, group.docsPath, 2);

  for (const file of files) {
    addWeightedTokens(weightedTokens, file.path, 3);
    addWeightedTokens(weightedTokens, file.category, 2);
    addWeightedTokens(weightedTokens, file.language, 1);
    addWeightedTokens(weightedTokens, file.role ?? "", 4);
    for (const symbol of symbolsByFileId.get(file.id) ?? []) {
      if (!symbol.exported) continue;
      addWeightedTokens(weightedTokens, symbol.name, 2);
      addWeightedTokens(weightedTokens, symbol.kind, 1);
    }
  }

  for (const entrypoint of entrypoints) {
    addWeightedTokens(weightedTokens, entrypoint.name, 10);
    addWeightedTokens(weightedTokens, entrypoint.kind, 5);
    addWeightedTokens(weightedTokens, entrypoint.handler, 4);
    addWeightedTokens(weightedTokens, entrypoint.path, 4);
    addWeightedTokens(weightedTokens, entrypoint.registrationPath, 3);
  }

  const hints = Array.from(weightedTokens.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, limit);

  return hints.length > 0 ? hints : [group.id];
}

function addWeightedTokens(
  weightedTokens: Map<string, number>,
  text: string,
  weight: number,
): void {
  for (const token of tokenizeForRouting(text)) {
    weightedTokens.set(token, (weightedTokens.get(token) ?? 0) + weight);
  }
}

const routingStopWords = new Set([
  "about",
  "after",
  "all",
  "and",
  "are",
  "async",
  "await",
  "bir",
  "blueprint",
  "class",
  "code",
  "const",
  "create",
  "de",
  "dir",
  "dosya",
  "dosyaları",
  "export",
  "file",
  "files",
  "for",
  "from",
  "function",
  "get",
  "group",
  "groups",
  "handle",
  "import",
  "index",
  "interface",
  "ile",
  "için",
  "leri",
  "ları",
  "let",
  "node",
  "olan",
  "olarak",
  "path",
  "proje",
  "result",
  "return",
  "set",
  "source",
  "src",
  "string",
  "test",
  "tests",
  "that",
  "the",
  "this",
  "tool",
  "tools",
  "type",
  "types",
  "typescript",
  "undefined",
  "unknown",
  "var",
  "variable",
  "with",
]);

function tokenizeForRouting(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9çğıöşü]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !routingStopWords.has(token));
}

function collectRelatedGroups(
  blueprint: BlueprintOutput,
  groupId: string,
  limit = 5,
): string[] {
  const groupsById = new Map(blueprint.groups.map((group) => [group.id, group]));
  return blueprint.edges
    .filter((edge) => edge.fromGroupId === groupId || edge.toGroupId === groupId)
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
    .reduce<string[]>((relatedGroups, edge) => {
      if (relatedGroups.length >= limit) {
        return relatedGroups;
      }
      const relatedGroupId = edge.fromGroupId === groupId ? edge.toGroupId : edge.fromGroupId;
      if (relatedGroups.some((entry) => entry.startsWith(`${relatedGroupId} (`))) {
        return relatedGroups;
      }
      const relatedGroup = groupsById.get(relatedGroupId);
      const label = relatedGroup?.id ?? relatedGroupId;
      relatedGroups.push(`${label} (${edge.type}: ${edge.count})`);
      return relatedGroups;
    }, []);
}

function groupBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

async function readBlueprintOutput(path: string): Promise<BlueprintOutput | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as BlueprintOutput;
  } catch {
    return undefined;
  }
}
