import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBlueprintCli } from "../../src/cli/index.js";

describe("blueprint open CLI", () => {
  it("uses cwd as projectRoot, renders the viewer, and opens the generated HTML", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "blueprint-cli-open-"));
    const calls: string[] = [];

    const code = await runBlueprintCli({
      argv: ["open"],
      cwd: projectRoot,
      render: async (root) => {
        calls.push(`render:${root}`);
        return { htmlPath: join(root, ".blueprint", "index.html") };
      },
      open: async (htmlPath) => {
        calls.push(`open:${htmlPath}`);
      },
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      `render:${projectRoot}`,
      `open:${join(projectRoot, ".blueprint", "index.html")}`,
    ]);
  });

  it("does not expose a separate render command in the first CLI surface", async () => {
    let stderr = "";

    const code = await runBlueprintCli({
      argv: ["render"],
      cwd: "/tmp/project",
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderr += String(chunk);
          return true;
        },
      },
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Usage: blueprint open");
  });

  it("supports open --watch by rendering, opening, then watching Blueprint memory sources", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "blueprint-cli-watch-"));
    const calls: string[] = [];

    const code = await runBlueprintCli({
      argv: ["open", "--watch", "--debounce", "10"],
      cwd: projectRoot,
      render: async (root) => {
        calls.push(`render:${root}`);
        return { htmlPath: join(root, ".blueprint", "index.html") };
      },
      open: async (htmlPath) => {
        calls.push(`open:${htmlPath}`);
      },
      watch: async (watchOptions) => {
        calls.push(`watch:${watchOptions.projectRoot}:${watchOptions.debounceMs}`);
      },
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      `render:${projectRoot}`,
      `open:${join(projectRoot, ".blueprint", "index.html")}`,
      `watch:${projectRoot}:10`,
    ]);
  });

  it("rejects unknown open options", async () => {
    let stderr = "";

    const code = await runBlueprintCli({
      argv: ["open", "--watc"],
      cwd: "/tmp/project",
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderr += String(chunk);
          return true;
        },
      },
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Unknown option: --watc");
    expect(stderr).toContain("Usage: blueprint open [--watch] [--debounce <ms>]");
  });
});
