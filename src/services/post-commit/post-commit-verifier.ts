import { type BlueprintReviewStatus } from "./review-markdown-writer.js";

export interface PostCommitVerificationInput {
  changedPaths: string[];
  allowedGroupDocs: string[];
  reviewPath: string;
  hasUnassignedFiles: boolean;
  commands?: string[];
  groupDocErrors?: string[];
}

export interface PostCommitVerificationResult {
  isValid: boolean;
  status: BlueprintReviewStatus;
  errors: string[];
  warnings: string[];
}

export function verifyPostCommitChanges(
  input: PostCommitVerificationInput,
): PostCommitVerificationResult {
  const allowedGroupDocs = new Set(input.allowedGroupDocs);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const command of input.commands ?? []) {
    errors.push(`Shell command used during blueprint maintainer run: ${command}`);
  }
  errors.push(...(input.groupDocErrors ?? []));

  for (const path of input.changedPaths) {
    if (isSourcePath(path)) {
      errors.push(`Source file changed during blueprint maintainer run: ${path}`);
      continue;
    }

    if (path.startsWith("blueprint/groups/") && path.endsWith(".md") && !allowedGroupDocs.has(path)) {
      errors.push(`Unexpected group doc changed: ${path}`);
    }
  }

  if (!input.changedPaths.includes(input.reviewPath)) {
    errors.push(`Review markdown was not written: ${input.reviewPath}`);
  }

  if (input.hasUnassignedFiles) {
    warnings.push("Unassigned files remain after blueprint maintainer run.");
  }

  return {
    isValid: errors.length === 0,
    status: errors.length > 0
      ? "failed"
      : warnings.length > 0
        ? "needs-human-review"
        : "clean",
    errors,
    warnings,
  };
}

function isSourcePath(path: string): boolean {
  return !path.startsWith("blueprint/");
}
