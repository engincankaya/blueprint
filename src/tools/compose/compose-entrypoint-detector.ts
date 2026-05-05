import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type FileInventory } from "../scan/scan-file-inventory-builder.js";
import { type BlueprintOutput } from "./compose.types.js";

export class ComposeEntrypointDetector {
  async detect(inventory?: FileInventory): Promise<BlueprintOutput["entrypoints"]> {
    if (!inventory) return [];

    const candidates = inventory.files.filter((file) =>
      file.parseable && /\.(?:[cm]?[jt]sx?)$/.test(file.path),
    );
    const entrypoints: BlueprintOutput["entrypoints"] = [];

    for (const file of candidates) {
      try {
        const source = await readFile(file.absolutePath, "utf-8");
        entrypoints.push(...this.detectFromSource(source, file.path));
      } catch {
        continue;
      }
    }

    return entrypoints.sort((a, b) =>
      a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
    );
  }

  private detectFromSource(
    source: string,
    path: string,
  ): BlueprintOutput["entrypoints"] {
    const entrypoints: BlueprintOutput["entrypoints"] = [];
    const importedHandlers = this.importedHandlerPaths(source, path);
    const registerToolPattern =
      /registerTool\(\s*["']([^"']+)["'][\s\S]*?async\s*\([^)]*\)\s*=>\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g;

    for (const match of source.matchAll(registerToolPattern)) {
      const [, name, handler] = match;
      if (!name || !handler) continue;
      const handlerOwner = handler.split(".")[0] ?? handler;
      entrypoints.push({
        kind: "mcp-tool",
        name,
        handler,
        path: importedHandlers.get(handler) ?? importedHandlers.get(handlerOwner) ?? path,
        registrationPath: path,
      });
    }

    return entrypoints;
  }

  private importedHandlerPaths(source: string, path: string): Map<string, string> {
    const imports = new Map<string, string>();
    const importPattern =
      /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']/g;

    for (const match of source.matchAll(importPattern)) {
      const [, names, specifier] = match;
      if (!names || !specifier?.startsWith(".")) continue;
      const resolvedPath = this.resolveImportPath(path, specifier);
      for (const rawName of names.split(",")) {
        const localName = rawName
          .trim()
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim();
        if (localName) imports.set(localName, resolvedPath);
      }
    }

    return imports;
  }

  private resolveImportPath(fromPath: string, specifier: string): string {
    const basePath = join(dirname(fromPath), specifier).replaceAll("\\", "/");
    if (basePath.endsWith(".js")) return `${basePath.slice(0, -3)}.ts`;
    if (basePath.endsWith(".jsx")) return `${basePath.slice(0, -4)}.tsx`;
    return basePath;
  }
}
