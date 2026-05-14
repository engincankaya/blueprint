import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const beginMarker = "<!-- BEGIN:blueprint-mcp-agent-rules -->";
const endMarker = "<!-- END:blueprint-mcp-agent-rules -->";

export async function patchAgentsInstructions(projectRoot: string): Promise<{
  path: string;
  changed: boolean;
}> {
  const path = join(projectRoot, "AGENTS.md");
  const snippet = renderBlueprintAgentsSnippet();
  let current = "";
  try {
    current = await readFile(path, "utf-8");
  } catch {
    await writeFile(path, `${snippet}\n`, "utf-8");
    return { path, changed: true };
  }

  const start = current.indexOf(beginMarker);
  const end = current.indexOf(endMarker);
  if (start >= 0 && end > start) {
    const endOffset = end + endMarker.length;
    const next = `${current.slice(0, start)}${snippet}${current.slice(endOffset)}`;
    if (next === current) return { path, changed: false };
    await writeFile(path, next, "utf-8");
    return { path, changed: true };
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(path, `${current}${separator}${snippet}\n`, "utf-8");
  return { path, changed: true };
}

export function renderBlueprintAgentsSnippet(): string {
  return [
    beginMarker,
    "",
    "## Blueprint MCP",
    "",
    "This project uses Blueprint MCP for local architecture memory.",
    "",
    "Before broad codebase exploration, read:",
    "",
    "`node_modules/blueprint-mcp/docs/agents.md`",
    "",
    "If Blueprint memory exists, start with:",
    "",
    "`.blueprint/brief.md`",
    "",
    endMarker,
  ].join("\n");
}
