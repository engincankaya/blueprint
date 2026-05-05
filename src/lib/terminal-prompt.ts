import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function buildTerminalPromptWithBrief(
  prompt: string,
  projectRoot: string,
): Promise<string> {
  const briefPath = join(resolve(projectRoot), "blueprint", "brief.md");
  if (!(await pathExists(briefPath))) {
    return prompt;
  }

  return [
    "Read this project brief before starting:",
    briefPath,
    "",
    "User request:",
    prompt,
  ].join("\n");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
