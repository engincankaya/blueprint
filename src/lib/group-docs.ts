import { readFile } from "node:fs/promises";

export const canonicalGroupDocSections = [
  "Snapshot",
  "Responsibilities",
  "Core Flow",
  "Contracts & Invariants",
  "Key Files",
  "Change Guide",
  "Pitfalls",
  "Tests",
  "Debugging",
  "Extension / Open Questions",
] as const;

export interface MarkdownSectionRef {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ParsedGroupDoc {
  frontmatter: Record<string, string>;
  title?: string;
  sections: MarkdownSectionRef[];
  validation: {
    isCanonical: boolean;
    warnings: string[];
  };
}

export async function readGroupDoc(path: string): Promise<ParsedGroupDoc> {
  return parseGroupDocMarkdown(await readFile(path, "utf-8"));
}

export function parseGroupDocMarkdown(markdown: string): ParsedGroupDoc {
  const lines = markdown.split(/\r?\n/);
  const { frontmatter, contentStartIndex } = parseFrontmatter(lines);
  const headings = collectHeadings(lines, contentStartIndex);
  const title = headings.find((heading) => heading.level === 1)?.heading;
  const sections = headings
    .filter((heading) => heading.level === 2)
    .map((heading, index, sectionHeadings) => {
      const endLine = (sectionHeadings[index + 1]?.startLine ?? lines.length + 1) - 1;
      return {
        ...heading,
        endLine,
        content: lines.slice(heading.startLine, endLine).join("\n").trim(),
      };
    });

  return {
    frontmatter,
    title,
    sections,
    validation: validateCanonicalGroupDoc(frontmatter, sections),
  };
}

function parseFrontmatter(lines: string[]): {
  frontmatter: Record<string, string>;
  contentStartIndex: number;
} {
  if (lines[0] !== "---") {
    return { frontmatter: {}, contentStartIndex: 0 };
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) {
    return { frontmatter: {}, contentStartIndex: 0 };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    frontmatter[match[1].trim()] = match[2].trim();
  }

  return { frontmatter, contentStartIndex: endIndex + 1 };
}

function collectHeadings(
  lines: string[],
  contentStartIndex: number,
): Array<Omit<MarkdownSectionRef, "endLine" | "content">> {
  const headings: Array<Omit<MarkdownSectionRef, "endLine" | "content">> = [];

  lines.forEach((line, index) => {
    if (index < contentStartIndex) return;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    headings.push({
      level: match[1].length,
      heading: match[2].trim(),
      startLine: index + 1,
    });
  });

  return headings;
}

function validateCanonicalGroupDoc(
  frontmatter: Record<string, string>,
  sections: MarkdownSectionRef[],
): ParsedGroupDoc["validation"] {
  const warnings: string[] = [];
  if (frontmatter.type !== "group-note") {
    warnings.push("frontmatter.type must be group-note");
  }
  if (!frontmatter.groupId) {
    warnings.push("frontmatter.groupId is required");
  }

  const actualHeadings = sections.map((section) => section.heading);
  canonicalGroupDocSections.forEach((expected, index) => {
    if (actualHeadings[index] !== expected) {
      warnings.push(`section ${index + 1} must be ${expected}`);
    }
  });
  if (actualHeadings.length !== canonicalGroupDocSections.length) {
    warnings.push(`expected ${canonicalGroupDocSections.length} canonical sections`);
  }

  return {
    isCanonical: warnings.length === 0,
    warnings,
  };
}
