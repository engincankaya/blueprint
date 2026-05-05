/**
 * Blueprint task context stage.
 *
 * `blueprint.task_context` turns a natural-language task into a compact,
 * deterministic context slice from an existing Blueprint output artifact. It
 * does not read source files and does not ask an LLM for interpretation.
 */
import { type ArtifactStore } from "../lib/artifact-store.js";
import { type ToolResult, errorResult, jsonResult } from "../types.js";
import { type BlueprintOutput } from "./compose/compose.types.js";

export interface TaskContextArgs {
  blueprintArtifactId: string;
  task: string;
  maxPrimaryFiles?: number;
  maxSecondaryFiles?: number;
  maxTests?: number;
  maxDocs?: number;
}

interface ScoredItem<T> {
  item: T;
  score: number;
  why: string[];
}

const defaultLimits = {
  primaryFiles: 5,
  secondaryFiles: 10,
  tests: 10,
  docs: 10,
};

const minPrimaryScore = 8;
const minPrimaryMatchedTokens = 2;
const maxSymbolScorePerFile = 30;
const maxRelatedSymbols = 30;
const documentationTaskTokens = new Set(["doc", "docs", "documentation", "markdown", "md", "readme", "vision"]);

const stopWords = new Set([
  "a",
  "add",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "bir",
  "blueprint",
  "bu",
  "common",
  "da",
  "de",
  "dominate",
  "do",
  "does",
  "drop",
  "ekle",
  "event",
  "fix",
  "for",
  "from",
  "guncelle",
  "ile",
  "in",
  "is",
  "it",
  "icin",
  "mi",
  "new",
  "of",
  "offline",
  "on",
  "or",
  "the",
  "to",
  "token",
  "tokens",
  "ve",
  "with",
  "ya",
]);

export async function handleTaskContext(
  args: TaskContextArgs,
  store: ArtifactStore,
): Promise<ToolResult> {
  const entry = store.get(args.blueprintArtifactId);
  if (!entry) {
    return errorResult(`Blueprint artifact not found: ${args.blueprintArtifactId}`);
  }
  if (entry.type !== "blueprintOutput") {
    return errorResult(
      `Expected blueprintOutput artifact, got ${entry.type}: ${args.blueprintArtifactId}`,
    );
  }

  const blueprint = entry.data as BlueprintOutput;
  const tokens = tokenize(args.task);
  const primaryLimit = limitOrDefault(args.maxPrimaryFiles, defaultLimits.primaryFiles);
  const secondaryLimit = limitOrDefault(args.maxSecondaryFiles, defaultLimits.secondaryFiles);
  const testLimit = limitOrDefault(args.maxTests, defaultLimits.tests);
  const docsLimit = limitOrDefault(args.maxDocs, defaultLimits.docs);

  const filesById = new Map(blueprint.files.map((file) => [file.id, file]));
  const groupsById = new Map(blueprint.groups.map((group) => [group.id, group]));
  const symbolsByFileId = groupBy(blueprint.symbols, (symbol) => symbol.fileId);
  const entrypointsByPath = groupBy(blueprint.entrypoints, (entrypoint) => entrypoint.path);
  const entrypointsByRegistrationPath = groupBy(
    blueprint.entrypoints,
    (entrypoint) => entrypoint.registrationPath,
  );

  const primaryFiles = blueprint.files
    .map((file) =>
      scoreFile(
        file,
        tokens,
        groupsById.get(file.groupId),
        symbolsByFileId.get(file.id) ?? [],
        entrypointsByPath.get(file.path) ?? [],
        entrypointsByRegistrationPath.get(file.path) ?? [],
      ),
    )
    .filter((scored) => isPrimaryCandidate(scored, tokens))
    .sort(compareScoredByPath)
    .slice(0, primaryLimit);

  const primaryFileIds = new Set(primaryFiles.map((scored) => scored.item.id));
  const relatedGroupIds = new Set(primaryFiles.map((scored) => scored.item.groupId));

  const relevantEdges = collectRelevantEdges(blueprint, primaryFileIds);
  const secondaryFiles = collectSecondaryFiles(
    blueprint,
    filesById,
    primaryFileIds,
    relatedGroupIds,
    secondaryLimit,
  );

  const relatedGroups = collectRelatedGroups(
    blueprint,
    groupsById,
    relatedGroupIds,
    tokens,
  );

  const relatedSymbols = collectRelatedSymbols(
    blueprint,
    primaryFileIds,
    tokens,
    maxRelatedSymbols,
  );

  const likelyTests = collectLikelyTests(
    blueprint,
    filesById,
    primaryFileIds,
    tokens,
    testLimit,
  );

  const docsToRead = collectDocsToRead(
    blueprint,
    primaryFiles.map((scored) => scored.item),
    relatedGroups.map((group) => group.id),
    docsLimit,
  );

  const watchOuts = collectWatchOuts(blueprint, primaryFiles.length, likelyTests.length);

  return jsonResult({
    task: args.task,
    primaryFiles: primaryFiles.map((scored) => ({
      id: scored.item.id,
      path: scored.item.path,
      groupId: scored.item.groupId,
      category: scored.item.category,
      language: scored.item.language,
      docsPath: scored.item.docsPath,
      score: scored.score,
      why: scored.why,
    })),
    secondaryFiles,
    relatedGroups,
    relatedSymbols,
    relevantEdges,
    likelyTests,
    docsToRead,
    watchOuts,
  });
}

function scoreFile(
  file: BlueprintOutput["files"][number],
  taskTokens: Set<string>,
  group: BlueprintOutput["groups"][number] | undefined,
  symbols: BlueprintOutput["symbols"],
  entrypoints: BlueprintOutput["entrypoints"],
  registrationEntryPoints: BlueprintOutput["entrypoints"],
): ScoredItem<BlueprintOutput["files"][number]> {
  const why: string[] = [];
  let score = 0;

  score += addTokenScore(
    taskTokens,
    tokenize(file.path),
    5,
    "path-token-match",
    why,
  );
  score += addTokenScore(
    taskTokens,
    tokenize(file.role ?? ""),
    2,
    "role-token-match",
    why,
  );

  if (group) {
    score += addTokenScore(
      taskTokens,
      tokenize(`${group.name} ${group.kind ?? ""} ${group.summary ?? ""}`),
      4,
      "group-token-match",
      why,
    );
  }

  let symbolScore = 0;
  for (const symbol of symbols) {
    symbolScore += addTokenScore(
      taskTokens,
      tokenize(`${symbol.name} ${symbol.kind} ${symbol.signature ?? ""}`),
      5,
      `symbol-name-match:${symbol.name}`,
      why,
    );
  }
  score += Math.min(symbolScore, maxSymbolScorePerFile);

  for (const entrypoint of entrypoints) {
    score += addTokenScore(
      taskTokens,
      tokenize(`${entrypoint.name} ${entrypoint.handler} ${entrypoint.kind}`),
      6,
      `entrypoint-match:${entrypoint.name}`,
      why,
    );
  }

  if (hasAnyToken(taskTokens, ["register", "registration", "server", "index"])) {
    for (const entrypoint of registrationEntryPoints) {
      score += addTokenScore(
        taskTokens,
        tokenize(`${entrypoint.name} ${entrypoint.handler} ${entrypoint.kind}`),
        8,
        `entrypoint-registration-match:${entrypoint.name}`,
        why,
      );
      score += 10;
      why.push(`registration-file:${entrypoint.name}`);
    }
  }

  return {
    item: file,
    score,
    why: unique(why),
  };
}

function collectSecondaryFiles(
  blueprint: BlueprintOutput,
  filesById: Map<string, BlueprintOutput["files"][number]>,
  primaryFileIds: Set<string>,
  relatedGroupIds: Set<string>,
  limit: number,
): Array<{
  id: string;
  path: string;
  groupId: string;
  category: string;
  docsPath?: string;
  score: number;
  why: string[];
}> {
  const candidates = new Map<string, ScoredItem<BlueprintOutput["files"][number]>>();

  for (const edge of blueprint.fileEdges) {
    if (primaryFileIds.has(edge.fromFileId) && !primaryFileIds.has(edge.toFileId)) {
      addSecondaryCandidate(candidates, filesById.get(edge.toFileId), 4, [
        `imported-by-primary:${edge.fromPath}`,
      ]);
    }
    if (primaryFileIds.has(edge.toFileId) && !primaryFileIds.has(edge.fromFileId)) {
      addSecondaryCandidate(candidates, filesById.get(edge.fromFileId), 3, [
        `imports-primary:${edge.toPath}`,
      ]);
    }
  }

  for (const file of blueprint.files) {
    if (primaryFileIds.has(file.id)) {
      continue;
    }
    if (relatedGroupIds.has(file.groupId)) {
      addSecondaryCandidate(candidates, file, 1, ["same-group-as-primary"]);
    }
  }

  return Array.from(candidates.values())
    .sort(compareScoredByPath)
    .slice(0, limit)
    .map((scored) => ({
      id: scored.item.id,
      path: scored.item.path,
      groupId: scored.item.groupId,
      category: scored.item.category,
      docsPath: scored.item.docsPath,
      score: scored.score,
      why: scored.why,
    }));
}

function isPrimaryCandidate(
  scored: ScoredItem<BlueprintOutput["files"][number]>,
  taskTokens: Set<string>,
): boolean {
  if (scored.item.category === "test") {
    return false;
  }
  if (scored.score < minPrimaryScore) {
    return false;
  }
  if (
    scored.item.category === "documentation" &&
    !hasTokenFromSet(taskTokens, documentationTaskTokens)
  ) {
    return false;
  }
  return collectMatchedTokens(scored.why).size >= minPrimaryMatchedTokens;
}

function collectRelatedGroups(
  blueprint: BlueprintOutput,
  groupsById: Map<string, BlueprintOutput["groups"][number]>,
  primaryGroupIds: Set<string>,
  taskTokens: Set<string>,
): Array<{
  id: string;
  name: string;
  kind?: string;
  docsPath: string;
  why: string[];
}> {
  const groups = new Map<string, { group: BlueprintOutput["groups"][number]; why: string[] }>();

  for (const groupId of primaryGroupIds) {
    const group = groupsById.get(groupId);
    if (group) {
      groups.set(group.id, { group, why: ["contains-primary-file"] });
    }
  }

  for (const group of blueprint.groups) {
    const overlap = tokenOverlap(
      taskTokens,
      tokenize(`${group.name} ${group.kind ?? ""} ${group.summary ?? ""}`),
    );
    if (overlap.length > 0) {
      const existing = groups.get(group.id);
      const why = existing?.why ?? [];
      why.push(`group-token-match:${overlap.join(",")}`);
      groups.set(group.id, { group, why: unique(why) });
    }
  }

  return Array.from(groups.values()).map(({ group, why }) => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    docsPath: group.docsPath,
    why,
  }));
}

function collectRelatedSymbols(
  blueprint: BlueprintOutput,
  primaryFileIds: Set<string>,
  taskTokens: Set<string>,
  limit: number,
): Array<{
  id: string;
  fileId: string;
  path: string;
  name: string;
  kind: string;
  exported: boolean;
  signature?: string;
  why: string[];
}> {
  return blueprint.symbols
    .map((symbol) => {
      const why: string[] = [];
      if (primaryFileIds.has(symbol.fileId)) {
        why.push("defined-in-primary-file");
      }
      const overlap = tokenOverlap(
        taskTokens,
        tokenize(`${symbol.name} ${symbol.kind} ${symbol.signature ?? ""}`),
      );
      if (overlap.length > 0) {
        why.push(`symbol-token-match:${overlap.join(",")}`);
      }
      return { symbol, why };
    })
    .filter(({ symbol, why }) => {
      if (why.length === 0) {
        return false;
      }
      if (primaryFileIds.has(symbol.fileId)) {
        return true;
      }
      return collectMatchedTokens(why).size >= minPrimaryMatchedTokens;
    })
    .sort((left, right) => {
      const leftPrimary = primaryFileIds.has(left.symbol.fileId) ? 1 : 0;
      const rightPrimary = primaryFileIds.has(right.symbol.fileId) ? 1 : 0;
      return rightPrimary - leftPrimary || left.symbol.path.localeCompare(right.symbol.path);
    })
    .slice(0, limit)
    .map(({ symbol, why }) => ({
      id: symbol.id,
      fileId: symbol.fileId,
      path: symbol.path,
      name: symbol.name,
      kind: symbol.kind,
      exported: symbol.exported,
      signature: symbol.signature,
      why: unique(why),
    }));
}

function collectRelevantEdges(
  blueprint: BlueprintOutput,
  primaryFileIds: Set<string>,
): {
  fileEdges: BlueprintOutput["fileEdges"];
  groupEdges: BlueprintOutput["edges"];
} {
  const fileEdges = blueprint.fileEdges.filter(
    (edge) => primaryFileIds.has(edge.fromFileId) || primaryFileIds.has(edge.toFileId),
  );
  const primaryGroupIds = new Set(
    blueprint.files
      .filter((file) => primaryFileIds.has(file.id))
      .map((file) => file.groupId),
  );
  const groupEdges = blueprint.edges.filter(
    (edge) =>
      primaryGroupIds.has(edge.fromGroupId) || primaryGroupIds.has(edge.toGroupId),
  );

  return { fileEdges, groupEdges };
}

function collectLikelyTests(
  blueprint: BlueprintOutput,
  filesById: Map<string, BlueprintOutput["files"][number]>,
  primaryFileIds: Set<string>,
  taskTokens: Set<string>,
  limit: number,
): Array<{
  fileId: string;
  path: string;
  confidence: number;
  why: string[];
}> {
  const candidates = new Map<string, { fileId: string; path: string; confidence: number; why: string[] }>();

  for (const link of blueprint.testLinks) {
    if (primaryFileIds.has(link.sourceFileId)) {
      candidates.set(link.testFileId, {
        fileId: link.testFileId,
        path: link.testPath,
        confidence: link.confidence,
        why: [`test-link:${link.sourcePath}`, ...link.reasons],
      });
    }
  }

  for (const file of blueprint.files) {
    if (file.category !== "test") {
      continue;
    }
    const overlap = tokenOverlap(taskTokens, tokenize(file.path));
    if (overlap.length === 0) {
      continue;
    }
    const existing = candidates.get(file.id);
    candidates.set(file.id, {
      fileId: file.id,
      path: file.path,
      confidence: Math.max(existing?.confidence ?? 0, 0.4),
      why: unique([...(existing?.why ?? []), `test-path-token-match:${overlap.join(",")}`]),
    });
  }

  for (const fileId of primaryFileIds) {
    const file = filesById.get(fileId);
    if (file?.category === "test") {
      const existing = candidates.get(file.id);
      candidates.set(file.id, {
        fileId: file.id,
        path: file.path,
        confidence: Math.max(existing?.confidence ?? 0, 1),
        why: unique([...(existing?.why ?? []), "primary-file-is-test"]),
      });
    }
  }

  return Array.from(candidates.values())
    .sort((left, right) => right.confidence - left.confidence || left.path.localeCompare(right.path))
    .slice(0, limit);
}

function collectDocsToRead(
  blueprint: BlueprintOutput,
  primaryFiles: BlueprintOutput["files"],
  relatedGroupIds: string[],
  limit: number,
): Array<{
  path: string;
  reason: string;
  severity?: "low" | "medium" | "high";
}> {
  const docs: Array<{ path: string; reason: string; severity?: "low" | "medium" | "high" }> = [];

  for (const groupId of relatedGroupIds) {
    const group = blueprint.groups.find((candidate) => candidate.id === groupId);
    if (group) {
      docs.push({ path: group.docsPath, reason: "related-group-doc" });
    }
  }

  for (const file of primaryFiles) {
    if (file.docsPath) {
      docs.push({ path: file.docsPath, reason: "primary-file-doc" });
    }
  }

  return uniqueDocs(docs).slice(0, limit);
}

function collectWatchOuts(
  blueprint: BlueprintOutput,
  primaryFileCount: number,
  testCount: number,
): Array<{
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
}> {
  const watchOuts: Array<{ code: string; severity: "low" | "medium" | "high"; message: string }> = [];

  if (primaryFileCount === 0) {
    watchOuts.push({
      code: "no-primary-files",
      severity: "medium",
      message: "No deterministic file match was found for the task text.",
    });
  }

  if (primaryFileCount > 0 && testCount === 0) {
    watchOuts.push({
      code: "no-tests-found",
      severity: "low",
      message: "No likely tests were linked to the matched primary files.",
    });
  }

  return watchOuts;
}

function addSecondaryCandidate(
  candidates: Map<string, ScoredItem<BlueprintOutput["files"][number]>>,
  file: BlueprintOutput["files"][number] | undefined,
  score: number,
  why: string[],
): void {
  if (!file || file.category === "test") {
    return;
  }
  const existing = candidates.get(file.id);
  candidates.set(file.id, {
    item: file,
    score: (existing?.score ?? 0) + score,
    why: unique([...(existing?.why ?? []), ...why]),
  });
}

function addTokenScore(
  sourceTokens: Set<string>,
  targetTokens: Set<string>,
  weight: number,
  reasonPrefix: string,
  why: string[],
): number {
  const overlap = tokenOverlap(sourceTokens, targetTokens);
  if (overlap.length === 0) {
    return 0;
  }
  why.push(`${reasonPrefix}:${overlap.join(",")}`);
  return overlap.length * weight;
}

function tokenOverlap(left: Set<string>, right: Set<string>): string[] {
  return Array.from(left).filter((token) => right.has(token)).sort();
}

function hasAnyToken(tokens: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function hasTokenFromSet(tokens: Set<string>, candidates: Set<string>): boolean {
  return Array.from(candidates).some((candidate) => tokens.has(candidate));
}

function collectMatchedTokens(why: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const reason of why) {
    const tokenListStart = reason.lastIndexOf(":");
    if (tokenListStart === -1) {
      continue;
    }
    const tokenList = reason.slice(tokenListStart + 1);
    for (const token of tokenList.split(",")) {
      if (token) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  );
}

function groupBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    pushMapValue(grouped, getKey(item), item);
  }
  return grouped;
}

function pushMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function compareScoredByPath<T extends { path: string }>(
  left: ScoredItem<T>,
  right: ScoredItem<T>,
): number {
  return right.score - left.score || left.item.path.localeCompare(right.item.path);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueDocs(
  docs: Array<{ path: string; reason: string; severity?: "low" | "medium" | "high" }>,
): Array<{ path: string; reason: string; severity?: "low" | "medium" | "high" }> {
  const seen = new Set<string>();
  const uniqueItems: Array<{ path: string; reason: string; severity?: "low" | "medium" | "high" }> = [];
  for (const doc of docs) {
    if (seen.has(doc.path)) {
      continue;
    }
    seen.add(doc.path);
    uniqueItems.push(doc);
  }
  return uniqueItems;
}

function limitOrDefault(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
