import { describe, expect, it } from "vitest";
import {
  EmbeddedBlueprintDataSource,
  type EmbeddedBlueprintData,
} from "../../frontend/src/lib/blueprint/data-source";

function createEmbeddedData(): EmbeddedBlueprintData {
  return {
    overview: {
      schemaVersion: "blueprint.v1",
      groups: [
        {
          id: "runtime",
          name: "Runtime",
          fileCount: 1,
          docsStatus: "ready",
          connections: [],
        },
      ],
      totals: {
        groups: 1,
        files: 1,
        edges: 0,
      },
      validation: {
        isValid: true,
        warnings: [],
      },
    },
    details: {
      runtime: {
        group: {
          id: "runtime",
          name: "Runtime",
          fileCount: 1,
          docsPath: ".blueprint/groups/runtime.md",
        },
        doc: {
          exists: true,
          frontmatter: {},
          sections: {
            snapshot: "Owns runtime.",
          },
          validation: {
            warnings: [],
          },
        },
        files: [
          {
            id: "file_index",
            path: "src/index.ts",
            category: "source",
            language: "typescript",
          },
        ],
        connections: [],
      },
    },
  };
}

describe("EmbeddedBlueprintDataSource", () => {
  it("reads overview and group details from the blueprint-data JSON script tag", async () => {
    const source = EmbeddedBlueprintDataSource.fromDocument({
      getElementById: (id) => id === "blueprint-data"
        ? { textContent: JSON.stringify(createEmbeddedData()) }
        : null,
    });

    expect(source).toBeDefined();
    if (!source) throw new Error("expected embedded data source");
    await expect(source.getOverview()).resolves.toMatchObject({
      schemaVersion: "blueprint.v1",
      totals: { groups: 1, files: 1, edges: 0 },
    });
    await expect(source.getGroup("runtime")).resolves.toMatchObject({
      group: {
        id: "runtime",
        docsPath: ".blueprint/groups/runtime.md",
      },
      doc: {
        sections: {
          snapshot: "Owns runtime.",
        },
      },
    });
  });

  it("does not subscribe to live updates in embedded static mode", () => {
    const source = new EmbeddedBlueprintDataSource(createEmbeddedData());

    expect(source.subscribe).toBeUndefined();
  });
});
