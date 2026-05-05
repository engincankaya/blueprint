import { type BlueprintOutput } from "../tools/compose/compose.types.js";

export const groupVisionSections = [
  {
    title: "Snapshot",
    guidance: "Give the coding agent a fast orientation in 3-6 lines.",
  },
  {
    title: "Responsibilities",
    guidance:
      "Define what this group owns, what belongs elsewhere, and ambiguous ownership lines.",
  },
  {
    title: "Core Flow",
    guidance: "Explain how data, control, or user actions move through this group.",
  },
  {
    title: "Contracts & Invariants",
    guidance:
      "List public contracts, schema rules, validation requirements, and behavior that must remain true.",
  },
  {
    title: "Key Files",
    guidance: "List only the important files that route an agent to the right source quickly.",
  },
  {
    title: "Change Guide",
    guidance: "Tell the agent what must be updated together when this group changes.",
  },
  {
    title: "Pitfalls",
    guidance:
      "Capture subtle risks, common wrong assumptions, stale-doc hazards, and behavior that is easy to break.",
  },
  {
    title: "Tests",
    guidance: "Name the smallest useful verification set and when to run broader tests.",
  },
  {
    title: "Debugging",
    guidance:
      "Describe the first artifacts, logs, files, or response fields to inspect when this group fails.",
  },
  {
    title: "Extension / Open Questions",
    guidance:
      "Capture future extension points and unresolved design questions without treating them as current rules.",
  },
];

export const groupVisionWritingStyle = [
  "Use clean Markdown that is easy for both a frontend reader and a coding assistant to scan.",
  "Prefer short paragraphs, bullet lists, and compact tables over long prose blocks.",
  "Use `A -> B -> C` arrows for runtime flow, ownership boundaries, and dependency direction when it clarifies the system.",
  "Use nested bullets sparingly; keep hierarchy shallow and readable.",
  "Mention concrete files, classes, methods, or contracts only when they explain responsibility or change impact.",
  "Do not paste raw JSON facts, full file lists, or generated schema dumps.",
  "Make `Change Guide`, `Pitfalls`, and `Tests` immediately actionable.",
];

export interface GroupVisionNoteTemplateInput {
  group: Pick<BlueprintOutput["groups"][number], "id" | "name">;
  factSnapshot: string;
  reviewedAt?: string;
}

export function renderGroupVisionNoteTemplate(input: GroupVisionNoteTemplateInput): string {
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const lines = [
    "---",
    `id: group-${slugifyPathPart(input.group.id)}`,
    "type: group-note",
    `groupId: ${input.group.id}`,
    "status: draft",
    `lastReviewedAt: ${reviewedAt}`,
    `factSnapshot: ${input.factSnapshot}`,
    "source: llm-authored",
    "---",
    "",
    `# ${input.group.name}`,
    "",
    "<!-- Writing style: keep sections compact, evidence-based, and useful for both frontend cards and coding agents. Avoid raw JSON dumps and full file lists. -->",
    "<!-- " + groupVisionWritingStyle.join(" ") + " -->",
    "",
    ...groupVisionSections.flatMap((section) => [
      `## ${section.title}`,
      "",
      `TODO: ${section.guidance}`,
      "",
    ]),
  ];

  return lines.join("\n");
}

export function slugifyPathPart(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
