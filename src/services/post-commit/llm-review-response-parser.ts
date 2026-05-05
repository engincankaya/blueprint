import { type BlueprintReviewGroupUpdateStatus } from "./review-markdown-writer.js";

export interface ParsedLlmReviewResponse {
  groupUpdate: BlueprintReviewGroupUpdateStatus;
  docsUpdated: string[];
  docsReviewedNoChange: string[];
  needsHumanReview: string[];
  notes: string[];
}

export function parseLlmReviewResponse(text: string): ParsedLlmReviewResponse {
  const groupUpdateRaw = readScalar(text, "groupUpdate");
  const docsUpdated = readList(text, "docsUpdated");
  const docsReviewedNoChange = readList(text, "docsReviewedNoChange");
  const needsHumanReview = readList(text, "needsHumanReview");
  const notes = readList(text, "notes");
  const groupUpdate = groupUpdateRaw === "called" || groupUpdateRaw === "not-needed"
    ? groupUpdateRaw
    : undefined;

  if (!groupUpdate) {
    return {
      groupUpdate: "not-needed",
      docsUpdated,
      docsReviewedNoChange,
      needsHumanReview: ["blueprint/reviews/latest"],
      notes: [
        "Could not parse LLM review response; human review required.",
        ...notes,
      ],
    };
  }

  return {
    groupUpdate,
    docsUpdated,
    docsReviewedNoChange,
    needsHumanReview,
    notes,
  };
}

function readScalar(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`${escapeRegExp(key)}:\\s*([^\\n]+)`));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}

function readList(text: string, key: string): string[] {
  const value = readScalar(text, key);
  if (!value) {
    return [];
  }

  const bracketed = value.match(/^\[(.*)\]$/);
  if (value === "[") {
    return [];
  }
  const listText = bracketed ? bracketed[1] ?? "" : value;
  return listText
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length > 0 && item !== "none");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
