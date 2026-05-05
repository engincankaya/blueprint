import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type PostCommitChangedFileContext } from "./post-commit-prompt-builder.js";

export type BlueprintReviewStatus = "clean" | "needs-human-review" | "failed";
export type BlueprintReviewGroupUpdateStatus = "called" | "not-needed";

export interface BlueprintReviewMarkdown {
  commit: string;
  range: string;
  status: BlueprintReviewStatus;
  createdAt: string;
  groupUpdate: BlueprintReviewGroupUpdateStatus;
  changedFiles: PostCommitChangedFileContext[];
  docsUpdated: string[];
  docsReviewedNoChange: string[];
  needsHumanReview: string[];
  notes: string[];
  summary: string[];
}

export class ReviewMarkdownWriter {
  async write(path: string, review: BlueprintReviewMarkdown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderReviewMarkdown(review), "utf-8");
  }
}

export function renderReviewMarkdown(review: BlueprintReviewMarkdown): string {
  return [
    "---",
    "type: blueprint-review",
    `commit: ${review.commit}`,
    `range: ${review.range}`,
    `status: ${review.status}`,
    `createdAt: ${review.createdAt}`,
    `groupUpdate: ${review.groupUpdate}`,
    "docsUpdated:",
    ...formatYamlList(review.docsUpdated),
    "docsReviewedNoChange:",
    ...formatYamlList(review.docsReviewedNoChange),
    "needsHumanReview:",
    ...formatYamlList(review.needsHumanReview),
    "---",
    "",
    `# Blueprint Review ${review.commit}`,
    "",
    "## Summary",
    "",
    ...formatMarkdownList(review.summary),
    "",
    "## Changed Files",
    "",
    "| Status | Path | Previous Group | Current Group | Group Doc |",
    "|---|---|---|---|---|",
    ...review.changedFiles.map(formatChangedFileRow),
    "",
    "## Group Update",
    "",
    `Status: ${review.groupUpdate}`,
    "",
    "## Docs Updated",
    "",
    ...formatDocList(review.docsUpdated),
    "",
    "## Reviewed, No Change",
    "",
    ...formatDocList(review.docsReviewedNoChange),
    "",
    "## Needs Human Review",
    "",
    ...formatDocList(review.needsHumanReview),
    "",
    "## Notes",
    "",
    ...formatMarkdownList(review.notes),
    "",
  ].join("\n");
}

function formatYamlList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `  - ${item}`) : ["  - none"];
}

function formatMarkdownList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"];
}

function formatDocList(items: string[]): string[] {
  return items.length > 0
    ? items.flatMap((item) => [`### ${item}`, ""])
    : ["- None"];
}

function formatChangedFileRow(file: PostCommitChangedFileContext): string {
  const path = file.status === "renamed" && file.oldPath
    ? `${file.oldPath} -> ${file.path}`
    : file.path;
  return [
    "",
    file.status,
    escapeCell(path),
    escapeCell(file.previousGroup ?? "-"),
    escapeCell(file.currentGroup ?? "-"),
    escapeCell(file.groupDocPath ?? "-"),
    "",
  ].join(" | ");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
