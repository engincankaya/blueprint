import { join } from "node:path";

export const defaultBlueprintDir = ".blueprint";

export const blueprintOutputFileName = "blueprint-output.json";
export const refreshScanFileName = "refresh-scan.json";
export const briefFileName = "brief.md";
export const groupsDirName = "groups";

export function blueprintDir(projectRoot: string): string {
  return join(projectRoot, defaultBlueprintDir);
}

export function blueprintOutputPath(projectRoot: string): string {
  return join(blueprintDir(projectRoot), blueprintOutputFileName);
}

export function refreshScanPath(projectRoot: string): string {
  return join(blueprintDir(projectRoot), refreshScanFileName);
}

export function briefPath(projectRoot: string): string {
  return join(blueprintDir(projectRoot), briefFileName);
}

export function groupDocsRelativePath(groupIdSlug: string): string {
  return `${defaultBlueprintDir}/${groupsDirName}/${groupIdSlug}.md`;
}

export function groupDocsDir(projectRoot: string): string {
  return join(blueprintDir(projectRoot), groupsDirName);
}

export function viewerHtmlPath(projectRoot: string): string {
  return join(blueprintDir(projectRoot), "index.html");
}

export function blueprintOutputReadCandidates(projectRoot: string): string[] {
  return [blueprintOutputPath(projectRoot)];
}

export function refreshScanReadCandidates(projectRoot: string): string[] {
  return [refreshScanPath(projectRoot)];
}

export function isBlueprintGeneratedPath(path: string): boolean {
  return path.startsWith(`${defaultBlueprintDir}/`);
}
