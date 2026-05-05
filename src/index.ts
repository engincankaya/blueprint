import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArtifactStore } from "./lib/artifact-store.js";
import { initTools } from "./tools/init-tools.js";
import { handleTaskContext } from "./tools/task-context.js";

const artifactStore = new ArtifactStore();
const tools = initTools();

const server = new McpServer({
  name: "blueprint",
  version: "0.1.0",
});
// ====== PROMPTS ======
server.registerPrompt(
  "blueprint-create-grouping-plan",
  {
    title: "Create Blueprint Grouping Plan",
    description:
      "Create a compact semantic GroupingPlan JSON from a blueprint.group prepare packet. " +
      "Use this before calling blueprint.group in apply mode.",
    argsSchema: {
      groupPreparePacketJson: z
        .string()
        .describe("JSON string of the packet returned by blueprint.group prepare mode"),
    },
  },
  ({ groupPreparePacketJson }) => ({
    description:
      "Ask the LLM to create only the compact GroupingPlan JSON needed by blueprint.group apply mode.",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Create a compact GroupingPlan JSON for blueprint.group apply mode.",
            "",
            "Rules:",
            "- Output only valid JSON. Do not include Markdown, comments, or explanation.",
            "- Use the provided group.prepare packet as input.",
            "- Prefer semantic groups based on responsibility, runtime role, data flow, and dependencies.",
            "- Treat folder names as hints, not truth. Do not blindly mirror folder names.",
            "- Prefer glob patterns such as folder/** for whole folders.",
            "- Do not list every file when a glob pattern can cover the same files.",
            "- Use exact file paths only for entry points, exceptions, or cross-cutting files.",
            "- Use exclude patterns for nested folders that belong to another group.",
            "- Cover every file through group include/exclude patterns plus fallback.",
            "- Prefer 5-8 groups and never exceed 12 groups.",
            "- Add a short project summary in project.summary.",
            "",
            "Required JSON shape:",
            JSON.stringify({
              project: {
                summary: "One short sentence explaining what this project does.",
                purpose: "Optional short product or runtime purpose.",
                architecture: "Optional short architecture shape.",
              },
              groups: [
                {
                  id: "stable-kebab-case-id",
                  name: "Human readable group name",
                  description: "One short sentence explaining the responsibility.",
                  kind: "runtime | feature | infrastructure | test | documentation | integration | other",
                  include: ["folder/**"],
                  exclude: ["folder/old/**"],
                  confidence: 0.9,
                },
              ],
              fallback: {
                strategy: "folder-category",
              },
            }, null, 2),
            "",
            "group.prepare packet JSON:",
            groupPreparePacketJson,
          ].join("\n"),
        },
      },
    ],
  }),
);

// ====== TOOLS ======
server.registerTool(
  "blueprint.scan",
  {
    title: "Scan Blueprint Project",
    description:
      "Public tool that builds a file inventory, analyzes parseable code, and returns the analysis artifact for grouping.",
    inputSchema: {
      rootPath: z.string().describe("Absolute path to repository root"),
      ignore: z
        .array(z.string())
        .optional()
        .describe("Additional glob patterns to ignore"),
      includeDefaultIgnored: z
        .boolean()
        .optional()
        .describe("When true, include default-ignored build, vendor, cache, and derived-output paths"),
      maxFiles: z
        .number()
        .optional()
        .default(10000)
        .describe("Maximum files to include in the inventory"),
    },
  },
  async (args) => tools.scanTool.handle(args, artifactStore),
);

server.registerTool(
  "blueprint.group",
  {
    title: "Group Blueprint Files",
    description:
      "Prepare mode returns a compact packet for semantic grouping; it is not the final grouping. " +
      "The LLM should treat folder names as hints, not truth, and group by responsibility, runtime role, data flow, and dependencies. " +
      "Prefer glob patterns like folder/** instead of enumerating files, and use exact file paths only for entry points, exceptions, or cross-cutting files. " +
      "Apply mode consumes a small LLM-authored GroupingPlan and deterministically assigns files.",
    inputSchema: {
      mode: z
        .enum(["prepare", "apply"])
        .describe("prepare builds an LLM packet; apply validates and stores a grouping plan"),
      analysisArtifactId: z
        .string()
        .describe("Analysis artifact ID returned by blueprint.scan"),
      plan: z
        .unknown()
        .optional()
        .describe("Grouping plan from the LLM. Required for apply mode."),
    },
  },
  async (args) => tools.groupTool.handle(args, artifactStore),
);

server.registerTool(
  "blueprint.group.update",
  {
    title: "Update Blueprint Groups",
    description:
      "Apply LLM group decisions after a Blueprint refresh. Use this tool only for assigning unassigned files " +
      "to existing groups, creating a new group for unassigned files, or deleting groups that are already empty. " +
      "Do not use this tool for updated files already assigned to a real group, deleted file cleanup, editing markdown memory, " +
      "or rewriting blueprint-output.json manually. Validation rules: assignments[].fileId must refer to a file whose groupId is \"__unassigned__\"; " +
      "assignments[].groupId must be an existing group id; newGroups[].id must not already exist; " +
      "newGroups[].fileIds must all be unassigned file ids; deleteGroups[] may only contain groups with no fileIds. " +
      "The tool writes blueprint/blueprint-output.json and creates group markdown templates for new groups.",
    inputSchema: {
      projectRoot: z.string().describe("Absolute path to the project root"),
      decision: z.object({
        assignments: z.array(z.object({
          fileId: z.string(),
          groupId: z.string(),
        })).default([]),
        newGroups: z.array(z.object({
          id: z.string(),
          name: z.string(),
          summary: z.string(),
          fileIds: z.array(z.string()),
        })).default([]),
        deleteGroups: z.array(z.string()).default([]),
      }),
    },
  },
  async (args) => tools.groupUpdateTool.handle(args),
);

server.registerTool(
  "blueprint.refresh",
  {
    title: "Refresh Blueprint Deterministically",
    description:
      "Deterministically refresh blueprint/blueprint-output.json from the current filesystem snapshot. " +
      "The tool compares blueprint/refresh-scan.json with a fresh full scan, writes refreshed Blueprint JSON and scan state, " +
      "and returns the maintenance prompt the assistant should follow. It does not send raw git diffs to the assistant. " +
      "Use blueprint.group.update afterwards only for unassigned files or empty group decisions, then update affected group Markdown docs.",
    inputSchema: {
      projectRoot: z.string().describe("Absolute path to the project root"),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, compute the refresh result without writing blueprint files"),
      changedPaths: z
        .array(z.string())
        .optional()
        .describe("Optional changed paths used only as an update fallback when no previous hash snapshot exists"),
      ignore: z
        .array(z.string())
        .optional()
        .describe("Additional glob patterns to ignore during the filesystem scan"),
      includeDefaultIgnored: z
        .boolean()
        .optional()
        .describe("When true, include default-ignored build, vendor, cache, and derived-output paths"),
      maxFiles: z
        .number()
        .optional()
        .default(10000)
        .describe("Maximum files to include in the inventory"),
    },
  },
  async (args) => tools.refreshTool.handle(args),
);

server.registerTool(
  "blueprint.compose",
  {
    title: "Compose Blueprint Output",
    description:
      "Compose the final frontend-ready Blueprint JSON from a grouping artifact. " +
      "If the response contains assistantNextSteps with required=true and executionPolicy=must_execute_before_final_response, " +
      "the assistant must execute those steps before giving the user a final answer. " +
      "For hydrate-group-docs, spawn one sub-agent per target group doc when sub-agents are available; otherwise edit the target docs yourself. " +
      "Do not ask the user unless the required step is impossible.",
    inputSchema: {
      groupingArtifactId: z
        .string()
        .describe("Artifact ID returned by blueprint.group apply mode"),
      language: z
        .string()
        .optional()
        .default("English")
        .describe("Language to use for Blueprint JSON summaries and group Markdown docs. Defaults to English."),
    },
  },
  async (args) => tools.composeTool.handle(args, artifactStore),
);

server.registerTool(
  "blueprint.task_context",
  {
    title: "Build Blueprint Task Context",
    description:
      "Return a compact deterministic context slice for a natural-language task from a Blueprint output artifact.",
    inputSchema: {
      blueprintArtifactId: z
        .string()
        .describe("Artifact ID returned by blueprint.compose"),
      task: z
        .string()
        .describe("Natural-language task input to route through the Blueprint graph"),
      maxPrimaryFiles: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum primary files to return"),
      maxSecondaryFiles: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum secondary files to return"),
      maxTests: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum likely test files to return"),
      maxDocs: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum Markdown docs to recommend reading"),
    },
  },
  async (args) => handleTaskContext(args, artifactStore),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Blueprint MCP Server v0.1.0 running on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error starting Blueprint MCP Server:", error);
  process.exit(1);
});
