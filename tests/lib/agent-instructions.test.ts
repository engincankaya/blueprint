import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { patchAgentsInstructions } from "../../src/lib/agent-instructions.js";

describe("patchAgentsInstructions", () => {
  it("creates AGENTS.md with Blueprint MCP snippet when the file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "blueprint-agents-create-"));

    const result = await patchAgentsInstructions(root);
    const content = await readFile(join(root, "AGENTS.md"), "utf-8");

    expect(result.changed).toBe(true);
    expect(content).toContain("BEGIN:blueprint-mcp-agent-rules");
    expect(content).toContain("node_modules/blueprint-mcp-server/docs/agents.md");
    expect(content).toContain("`.blueprint/brief.md`");
  });

  it("appends the snippet without overwriting existing project instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "blueprint-agents-append-"));
    await writeFile(join(root, "AGENTS.md"), "# Project Rules\n\nRun tests first.\n", "utf-8");

    await patchAgentsInstructions(root);
    const content = await readFile(join(root, "AGENTS.md"), "utf-8");

    expect(content).toContain("# Project Rules\n\nRun tests first.");
    expect(content).toContain("BEGIN:blueprint-mcp-agent-rules");
  });

  it("updates only the marker block when the Blueprint snippet already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "blueprint-agents-update-"));
    await writeFile(
      join(root, "AGENTS.md"),
      [
        "# Project Rules",
        "",
        "<!-- BEGIN:blueprint-mcp-agent-rules -->",
        "old snippet",
        "<!-- END:blueprint-mcp-agent-rules -->",
        "",
        "Keep this footer.",
        "",
      ].join("\n"),
      "utf-8",
    );

    await patchAgentsInstructions(root);
    const content = await readFile(join(root, "AGENTS.md"), "utf-8");

    expect(content).toContain("# Project Rules");
    expect(content).toContain("Keep this footer.");
    expect(content).not.toContain("old snippet");
    expect(content.match(/BEGIN:blueprint-mcp-agent-rules/g)).toHaveLength(1);
  });
});
