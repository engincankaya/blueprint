import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { parseJsonToolResult } from "../../src/types.js";
import { ScanTool } from "../../src/tools/scan/index.js";
import { CodeAnalysisEngine } from "../../src/tools/scan/scan-code-analysis-engine.js";
import { FileInventoryBuilder } from "../../src/tools/scan/scan-file-inventory-builder.js";

function createScanTool(): ScanTool {
  return new ScanTool(new FileInventoryBuilder(), new CodeAnalysisEngine());
}

interface ScanResponse {
  artifactId: string;
  inventoryArtifactId: string;
  summary: {
    totalFiles: number;
    parsedFiles: number;
    parseErrors: number;
  };
  validationStatus: {
    isComplete: boolean;
  };
  next: {
    tool: "blueprint.group";
    input: {
      analysisArtifactId: string;
    };
  };
}

async function createFixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blueprint-scan-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf-8");
  await writeFile(
    join(root, "src", "helper.ts"),
    "export function helper() { return 42; }\n",
    "utf-8",
  );
  await writeFile(
    join(root, "src", "index.ts"),
    "import { helper } from './helper.js';\nexport const value = helper();\n",
    "utf-8",
  );
  await writeFile(join(root, "README.md"), "# Fixture\n", "utf-8");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored();\n", "utf-8");
  return root;
}

async function createDefaultIgnoreFixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blueprint-scan-default-ignore-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "# no local ignores\n", "utf-8");
  await writeFile(
    join(root, "src", "index.ts"),
    "export const value = 1;\n",
    "utf-8",
  );
  await writeFile(join(root, "dist", "bundle.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored();\n", "utf-8");
  await writeFile(join(root, "blueprint-output.json"), "{}\n", "utf-8");
  return root;
}

describe("blueprint.scan", () => {
  it("runs initiate and analyze internally while returning a compact analysis artifact response", async () => {
    const scanTool = createScanTool();
    const store = new ArtifactStore();
    const rootPath = await createFixtureRepo();

    const response = parseJsonToolResult<ScanResponse>(
      await scanTool.handle({ rootPath }, store),
    );

    expect(response.artifactId).toBe(response.next.input.analysisArtifactId);
    expect(response.summary).toEqual({
      totalFiles: 4,
      parsedFiles: 2,
      parseErrors: 0,
    });
    expect(response.validationStatus).toEqual({
      isComplete: true,
    });

    const inventory = store.get(response.inventoryArtifactId);
    const analysis = store.get(response.artifactId);
    expect(inventory?.type).toBe("fileInventory");
    expect(analysis?.type).toBe("analysisFacts");
    expect(JSON.stringify(inventory?.data)).not.toContain("node_modules/pkg/index.js");
  });

  it("applies default ignore rules inside the scan wrapper unless explicitly overridden", async () => {
    const scanTool = createScanTool();
    const store = new ArtifactStore();
    const rootPath = await createDefaultIgnoreFixtureRepo();

    const defaultResponse = parseJsonToolResult<ScanResponse>(
      await scanTool.handle({ rootPath }, store),
    );
    const defaultInventory = store.get(defaultResponse.inventoryArtifactId);
    expect(JSON.stringify(defaultInventory?.data)).not.toContain("dist/bundle.js");
    expect(JSON.stringify(defaultInventory?.data)).not.toContain("node_modules/pkg/index.js");
    expect(JSON.stringify(defaultInventory?.data)).not.toContain("blueprint-output.json");

    const overrideStore = new ArtifactStore();
    const overrideResponse = parseJsonToolResult<ScanResponse>(
      await scanTool.handle({ rootPath, includeDefaultIgnored: true }, overrideStore),
    );
    const overrideInventory = overrideStore.get(overrideResponse.inventoryArtifactId);
    expect(JSON.stringify(overrideInventory?.data)).toContain("dist/bundle.js");
    expect(JSON.stringify(overrideInventory?.data)).toContain("node_modules/pkg/index.js");
    expect(JSON.stringify(overrideInventory?.data)).toContain("blueprint-output.json");
  });
});
