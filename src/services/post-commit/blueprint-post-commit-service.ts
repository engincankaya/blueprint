import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { ArtifactStore } from "../../lib/artifact-store.js";
import { parseGroupDocMarkdown } from "../../lib/group-docs.js";
import { parseJsonToolResult } from "../../types.js";
import { type BlueprintOutput } from "../../tools/compose/compose.types.js";
import { FileInventoryBuilder, type FileInventory } from "../../tools/scan/scan-file-inventory-builder.js";
import { type ScannedBlueprintFile } from "../../tools/refresh/refresh.types.js";
import { buildChangedFileContexts } from "./changed-file-context-builder.js";
import { CommitDiffReader, type CommitDiff } from "./commit-diff-reader.js";
import { parseLlmReviewResponse, type ParsedLlmReviewResponse } from "./llm-review-response-parser.js";
import { buildPostCommitPrompt } from "./post-commit-prompt-builder.js";
import { PostCommitRefreshAdapter } from "./post-commit-refresh.js";
import { verifyPostCommitChanges, type PostCommitVerificationResult } from "./post-commit-verifier.js";
import { ReviewFileNamer } from "./review-file-namer.js";
import {
  ReviewMarkdownWriter,
  type BlueprintReviewMarkdown,
  type BlueprintReviewStatus,
} from "./review-markdown-writer.js";

export interface BlueprintPostCommitLlmResult {
  response: string;
  runDetails?: {
    commands?: Array<{ command: string }>;
    files?: Array<{ path: string; action?: string }>;
  };
}

export type BlueprintPostCommitLlmRunner = (
  prompt: string,
  args: {
    projectRoot: string;
    allowedGroupDocs: string[];
  },
) => Promise<BlueprintPostCommitLlmResult>;

export interface BlueprintPostCommitServiceOptions {
  diffReader?: Pick<CommitDiffReader, "read">;
  reviewFileNamer?: ReviewFileNamer;
  reviewWriter?: ReviewMarkdownWriter;
  fileInventoryBuilder?: FileInventoryBuilder;
  refreshAdapter?: PostCommitRefreshAdapter;
  llmRunner?: BlueprintPostCommitLlmRunner;
}

export interface BlueprintPostCommitServiceResult {
  ok: boolean;
  reviewPath: string;
  prompt: string;
  diff: CommitDiff;
  llm: {
    ran: boolean;
    response?: string;
    runDetails?: BlueprintPostCommitLlmResult["runDetails"];
  };
}

export class BlueprintPostCommitService {
  private readonly diffReader: Pick<CommitDiffReader, "read">;
  private readonly reviewFileNamer: ReviewFileNamer;
  private readonly reviewWriter: ReviewMarkdownWriter;
  private readonly fileInventoryBuilder: FileInventoryBuilder;
  private readonly refreshAdapter: PostCommitRefreshAdapter;
  private readonly llmRunner?: BlueprintPostCommitLlmRunner;

  constructor(options: BlueprintPostCommitServiceOptions = {}) {
    this.diffReader = options.diffReader ?? new CommitDiffReader();
    this.reviewFileNamer = options.reviewFileNamer ?? new ReviewFileNamer();
    this.reviewWriter = options.reviewWriter ?? new ReviewMarkdownWriter();
    this.fileInventoryBuilder = options.fileInventoryBuilder ?? new FileInventoryBuilder();
    this.refreshAdapter = options.refreshAdapter ?? new PostCommitRefreshAdapter();
    this.llmRunner = options.llmRunner;
  }

  async handle(args: {
    projectRoot: string;
    before: string;
    after: string;
    runLlm?: boolean;
    createdAt?: string;
  }): Promise<BlueprintPostCommitServiceResult> {
    const diff = await this.diffReader.read({
      projectRoot: args.projectRoot,
      before: args.before,
      after: args.after,
    });
    const previous = await readBlueprintOutput(args.projectRoot);
    const previousScan = await readRefreshScan(args.projectRoot);
    const currentScan = await this.scanCurrentFiles(args.projectRoot);
    const refresh = this.refreshAdapter.refresh({
      previous,
      previousScan,
      currentScan,
      changedPaths: diff.changedFiles.flatMap((file) => [
        ...(file.oldPath ? [file.oldPath] : []),
        file.path,
      ]),
    });
    await writeRefreshOutputs(args.projectRoot, refresh.output, currentScan);
    const current = refresh.output;
    const context = buildChangedFileContexts({
      previous,
      current,
      changes: diff.changedFiles,
    });
    const affectedGroupDocContents = await readAffectedGroupDocContents(
      args.projectRoot,
      context.affectedGroupDocs,
    );
    const prompt = buildPostCommitPrompt({
      commit: diff.after,
      range: `${diff.before}..${diff.after}`,
      changedFiles: context.changedFiles,
      unassignedFiles: context.unassignedFiles,
      affectedGroupDocs: context.affectedGroupDocs,
      affectedGroupDocContents,
      projectLanguage: current.project.language ?? "English",
      rawDiff: diff.rawDiff,
    });
    const reviewPath = await this.reviewFileNamer.pathFor({
      projectRoot: args.projectRoot,
      subject: diff.subject,
      shortSha: diff.shortSha,
    });

    const llm = await this.runLlmIfNeeded(args.projectRoot, args.runLlm === true, prompt, context.affectedGroupDocs);
    const parsed = llm.ran && llm.response
      ? parseLlmReviewResponse(llm.response)
      : defaultNoLlmReview(context.affectedGroupDocs);
    const postLlmOutput = llm.ran ? await readBlueprintOutput(args.projectRoot) : current;
    const reviewContext = llm.ran
      ? buildChangedFileContexts({
        previous,
        current: postLlmOutput,
        changes: diff.changedFiles,
      })
      : context;
    const groupDocValidation = llm.ran
      ? await validatePostCommitGroupDocs({
        projectRoot: args.projectRoot,
        beforeLlm: current,
        afterLlm: postLlmOutput,
        affectedGroupDocs: reviewContext.affectedGroupDocs,
        llmChangedFiles: llm.runDetails?.files?.map((file) => file.path) ?? [],
      })
      : {
        allowedGroupDocs: reviewContext.affectedGroupDocs,
        errors: [],
      };
    const verification = verifyPostCommitChanges({
      changedPaths: [
        ...new Set([
          "blueprint/blueprint-output.json",
          "blueprint/refresh-scan.json",
          ...((llm.runDetails?.files ?? []).map((file) => file.path)),
          relativeBlueprintPath(args.projectRoot, reviewPath),
        ]),
      ],
      allowedGroupDocs: groupDocValidation.allowedGroupDocs,
      reviewPath: relativeBlueprintPath(args.projectRoot, reviewPath),
      hasUnassignedFiles: reviewContext.unassignedFiles.length > 0,
      commands: llm.runDetails?.commands?.map((command) => command.command),
      groupDocErrors: groupDocValidation.errors,
    });
    const review = this.buildReview({
      diff,
      context: reviewContext,
      parsed,
      createdAt: args.createdAt ?? new Date().toISOString(),
      verification,
    });
    await this.reviewWriter.write(reviewPath, review);

    return {
      ok: true,
      reviewPath,
      prompt,
      diff,
      llm,
    };
  }

  private async scanCurrentFiles(projectRoot: string): Promise<ScannedBlueprintFile[]> {
    const store = new ArtifactStore();
    const initiate = parseJsonToolResult<{ artifactId: string }>(
      await this.fileInventoryBuilder.handle({ rootPath: projectRoot }, store),
    );
    const inventory = store.getTyped<FileInventory>(initiate.artifactId, "fileInventory");
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

  private async runLlmIfNeeded(
    projectRoot: string,
    runLlm: boolean,
    prompt: string,
    allowedGroupDocs: string[],
  ): Promise<BlueprintPostCommitServiceResult["llm"]> {
    if (!runLlm || !this.llmRunner) {
      return { ran: false };
    }

    const result = await this.llmRunner(prompt, {
      projectRoot,
      allowedGroupDocs,
    });
    return {
      ran: true,
      response: result.response,
      ...(result.runDetails ? { runDetails: result.runDetails } : {}),
    };
  }

  private buildReview(args: {
    diff: CommitDiff;
    context: ReturnType<typeof buildChangedFileContexts>;
    parsed: ParsedLlmReviewResponse;
    createdAt: string;
    verification: PostCommitVerificationResult;
  }): BlueprintReviewMarkdown {
    const status: BlueprintReviewStatus = args.verification.status === "failed"
      ? "failed"
      : args.parsed.needsHumanReview.length > 0 || args.verification.warnings.length > 0
      ? "needs-human-review"
      : "clean";

    return {
      commit: args.diff.after,
      range: `${args.diff.before}..${args.diff.after}`,
      status,
      createdAt: args.createdAt,
      groupUpdate: args.parsed.groupUpdate,
      changedFiles: args.context.changedFiles,
      docsUpdated: args.parsed.docsUpdated,
      docsReviewedNoChange: args.parsed.docsReviewedNoChange,
      needsHumanReview: [
        ...args.parsed.needsHumanReview,
        ...args.verification.errors,
        ...args.verification.warnings,
      ],
      notes: [
        ...args.parsed.notes,
        ...args.verification.errors,
        ...args.verification.warnings,
      ],
      summary: [
        `Changed files: ${args.context.changedFiles.length}`,
        `Affected group docs: ${args.context.affectedGroupDocs.length}`,
      ],
    };
  }
}

function relativeBlueprintPath(projectRoot: string, path: string): string {
  return relative(projectRoot, path);
}

async function readBlueprintOutput(projectRoot: string): Promise<BlueprintOutput> {
  const raw = await readFile(join(projectRoot, "blueprint", "blueprint-output.json"), "utf-8");
  return JSON.parse(raw) as BlueprintOutput;
}

async function readRefreshScan(projectRoot: string): Promise<ScannedBlueprintFile[]> {
  try {
    const raw = await readFile(join(projectRoot, "blueprint", "refresh-scan.json"), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isScannedBlueprintFile)
      : [];
  } catch {
    return [];
  }
}

async function writeRefreshOutputs(
  projectRoot: string,
  output: BlueprintOutput,
  currentScan: ScannedBlueprintFile[],
): Promise<void> {
  await mkdir(join(projectRoot, "blueprint"), { recursive: true });
  await writeFile(
    join(projectRoot, "blueprint", "blueprint-output.json"),
    JSON.stringify(output, null, 2),
    "utf-8",
  );
  await writeFile(
    join(projectRoot, "blueprint", "refresh-scan.json"),
    JSON.stringify(currentScan, null, 2),
    "utf-8",
  );
}

async function readAffectedGroupDocContents(
  projectRoot: string,
  affectedGroupDocs: string[],
): Promise<Array<{ path: string; content: string }>> {
  const contents: Array<{ path: string; content: string }> = [];
  for (const docsPath of affectedGroupDocs) {
    try {
      contents.push({
        path: docsPath,
        content: await readFile(join(projectRoot, docsPath), "utf-8"),
      });
    } catch {
      // Missing docs are already visible in the affected-docs list; prompt generation should continue.
    }
  }
  return contents;
}

function isScannedBlueprintFile(value: unknown): value is ScannedBlueprintFile {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { path?: unknown }).path === "string"
    && typeof (value as { hash?: unknown }).hash === "string"
    && typeof (value as { category?: unknown }).category === "string"
    && typeof (value as { language?: unknown }).language === "string";
}

function defaultNoLlmReview(affectedGroupDocs: string[]): ParsedLlmReviewResponse {
  return {
    groupUpdate: "not-needed",
    docsUpdated: [],
    docsReviewedNoChange: affectedGroupDocs,
    needsHumanReview: [],
    notes: ["LLM disabled; wrote deterministic post-commit review artifact."],
  };
}

async function validatePostCommitGroupDocs(args: {
  projectRoot: string;
  beforeLlm: BlueprintOutput;
  afterLlm: BlueprintOutput;
  affectedGroupDocs: string[];
  llmChangedFiles: string[];
}): Promise<{
  allowedGroupDocs: string[];
  errors: string[];
}> {
  const beforeDocs = new Set(args.beforeLlm.groups.map((group) => group.docsPath));
  const createdDocs = args.afterLlm.groups
    .map((group) => group.docsPath)
    .filter((docsPath) => !beforeDocs.has(docsPath));
  const touchedGroupDocs = args.llmChangedFiles
    .filter((path) => path.startsWith("blueprint/groups/") && path.endsWith(".md"));
  const allowedGroupDocs = Array.from(new Set([
    ...args.affectedGroupDocs,
    ...createdDocs,
  ])).sort();
  const docsToValidate = Array.from(new Set([
    ...allowedGroupDocs,
    ...touchedGroupDocs,
  ])).sort();
  const errors: string[] = [];

  for (const docsPath of docsToValidate) {
    try {
      const raw = await readFile(join(args.projectRoot, docsPath), "utf-8");
      const parsed = parseGroupDocMarkdown(raw);
      if (!parsed.validation.isCanonical) {
        errors.push(
          `Group doc is not canonical: ${docsPath}: ${parsed.validation.warnings.join("; ")}`,
        );
      }
      if (/\bTODO\b/.test(raw)) {
        errors.push(`Group doc is still a template: ${docsPath}`);
      }
    } catch (error) {
      errors.push(
        `Group doc could not be read: ${docsPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    allowedGroupDocs,
    errors,
  };
}
