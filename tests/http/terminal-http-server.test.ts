import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { TerminalCommandRunner } from "../../src/lib/terminal-runner.js";
import {
  handleTerminalQueryBody,
  handleTerminalQueryStreamRequest,
  type TerminalQueryHttpBody,
} from "../../src/server/routes/index.js";
import { TerminalQueryService } from "../../src/services/terminal-query-service.js";
import { CodexTerminalProvider } from "../../src/cli-providers/codex-terminal-provider.js";
import { type BlueprintOutput } from "../../src/tools/compose/compose.types.js";

interface CapturedRun {
  file: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

function createRunner(stdout: string): {
  captured: CapturedRun[];
  runner: TerminalCommandRunner;
} {
  const captured: CapturedRun[] = [];
  return {
    captured,
    runner: async (request) => {
      captured.push(request);
      return {
        stdout,
        stderr: "",
        exitCode: 0,
        durationMs: 7,
        timedOut: false,
      };
    },
  };
}

function createRunnerSequence(stdoutByRun: string[]): {
  captured: CapturedRun[];
  runner: TerminalCommandRunner;
} {
  const captured: CapturedRun[] = [];
  return {
    captured,
    runner: async (request) => {
      captured.push(request);
      return {
        stdout: stdoutByRun[captured.length - 1] ?? "",
        stderr: "",
        exitCode: 0,
        durationMs: 7,
        timedOut: false,
      };
    },
  };
}

function createTerminalQueryService(runner: TerminalCommandRunner): TerminalQueryService {
  return new TerminalQueryService(runner, [new CodexTerminalProvider()]);
}

function createStreamingRunner(stdout: string): TerminalCommandRunner {
  return async (request) => {
    for (const line of stdout.split(/\n/)) {
      request.onStdout?.(`${line}\n`);
    }
    return {
      stdout,
      stderr: "",
      exitCode: 0,
      durationMs: 7,
      timedOut: false,
    };
  };
}

function createJsonRequest(body: unknown): IncomingMessage {
  return Readable.from([JSON.stringify(body)]) as IncomingMessage;
}

function createResponseRecorder(): ServerResponse & {
  statusCodeWritten?: number;
  headersWritten?: Record<string, string>;
  body: string;
} {
  const recorder = {
    body: "",
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCodeWritten = statusCode;
      this.headersWritten = headers;
      return this;
    },
    write(chunk: string) {
      this.body += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) {
        this.body += chunk;
      }
      return this;
    },
  };
  return recorder as ServerResponse & {
    statusCodeWritten?: number;
    headersWritten?: Record<string, string>;
    body: string;
  };
}

function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  return body.trim().split(/\n\n/).map((block) => {
    const event = block.match(/^event: (.+)$/m)?.[1] ?? "message";
    const data = block.match(/^data: (.+)$/m)?.[1] ?? "{}";
    return { event, data: JSON.parse(data) as unknown };
  });
}

async function handleTerminalQueryHttpPayload(
  body: TerminalQueryHttpBody,
  options: {
    projectRoot: string;
    terminalQueryService: TerminalQueryService;
    logger?: (message: string) => void;
  },
) {
  return handleTerminalQueryBody(
    options.projectRoot,
    body,
    options.terminalQueryService,
    options.logger,
  );
}

function createBlueprintOutput(): BlueprintOutput {
  return {
    schemaVersion: "blueprint.v1",
    project: {
      analysisArtifactId: "analysis_1",
      inventoryArtifactId: "inventory_1",
    },
    groups: [
      {
        id: "runtime",
        name: "Runtime",
        kind: "runtime",
        summary: "Owns MCP registration and process startup.",
        docsPath: "blueprint/groups/runtime.md",
        fileIds: ["file_index", "file_types"],
      },
    ],
    files: [
      {
        id: "file_index",
        path: "src/index.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        docsPath: "blueprint/files/src-index.md",
        notesStatus: "missing",
        summary: "Registers public MCP tools.",
        role: "entrypoint",
      },
      {
        id: "file_types",
        path: "src/types.ts",
        groupId: "runtime",
        category: "source",
        language: "typescript",
        docsPath: "blueprint/files/src-types.md",
        notesStatus: "missing",
        summary: "Defines shared tool response helpers.",
        role: "contract",
      },
    ],
    edges: [],
    fileEdges: [],
    symbols: [
      {
        id: "symbol_hidden",
        fileId: "file_index",
        path: "src/index.ts",
        name: "hiddenFunction",
        kind: "function",
        exported: false,
      },
    ],
    entrypoints: [
      {
        kind: "mcp-tool",
        name: "blueprint.scan",
        handler: "handleScan",
        path: "src/tools/scan.ts",
        registrationPath: "src/index.ts",
      },
    ],
    testLinks: [],
    validation: {
      isValid: true,
      groupingComplete: true,
      documentationValid: true,
      groupingIssueSummary: [],
      groupingWarningSummary: [],
      missingGroupDocs: [],
      missingFileDocs: [],
      undocumentedSelectedGroupIds: [],
      undocumentedSelectedFileIds: [],
    },
  };
}

describe("terminal HTTP bridge", () => {
  it("streams terminal chat deltas and run details as SSE events", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-stream-"));
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_stream_http" }),
      JSON.stringify({ type: "agent_message", message: "Working." }),
      JSON.stringify({
        type: "item.started",
        item: {
          type: "command_execution",
          command: "npm test",
          status: "in_progress",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          path: "src/server/index.ts",
          action: "modified",
        },
      }),
      JSON.stringify({ type: "agent_message", message: "Done." }),
    ].join("\n");
    const response = createResponseRecorder();

    await handleTerminalQueryStreamRequest(
      projectRoot,
      createJsonRequest({ prompt: "Stream this", chatId: "chat_http", mode: "ask" }),
      response,
      createTerminalQueryService(createStreamingRunner(stdout)),
    );

    expect(response.statusCodeWritten).toBe(200);
    expect(response.headersWritten).toMatchObject({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    });
    expect(parseSseEvents(response.body)).toEqual([
      { event: "delta", data: { text: "Working." } },
      { event: "command", data: { command: "npm test", status: "in_progress" } },
      { event: "file", data: { path: "src/server/index.ts", action: "modified" } },
      { event: "delta", data: { text: "Done." } },
      {
        event: "done",
        data: expect.objectContaining({
          answer: "Working.\nDone.",
          session: { chatId: "chat_http" },
          runDetails: expect.objectContaining({
            commands: [{ command: "npm test", status: "in_progress" }],
            files: [{ path: "src/server/index.ts", action: "modified" }],
          }),
        }),
      },
    ]);
  });

  it("routes frontend chat requests to Codex through the configured project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-root-"));
    const ignoredProjectRoot = await mkdtemp(join(tmpdir(), "terminal-http-ignored-"));
    const { captured, runner } = createRunner(
      JSON.stringify({ type: "agent_message", message: "HTTP bridge ok" }),
    );

    const response = await handleTerminalQueryHttpPayload(
      {
        prompt: "Inspect the project",
        mode: "ask",
        projectRoot: ignoredProjectRoot,
      },
      { projectRoot, terminalQueryService: createTerminalQueryService(runner) },
    );

    expect(response.statusCode).toBe(200);
    const body = response.payload as { answer: string };
    expect(body.answer).toBe("HTTP bridge ok");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      file: "codex",
      args: [
        "exec",
        "-c",
        'mcp_servers.mindmap.default_tools_approval_mode="approve"',
        "--json",
        "Inspect the project",
      ],
      cwd: projectRoot,
    });
  });

  it("adds the generated project brief file to Codex prompts when present", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-brief-"));
    await mkdir(join(projectRoot, "blueprint"), { recursive: true });
    await writeFile(
      join(projectRoot, "blueprint", "brief.md"),
      "# Project Blueprint Brief\n",
      "utf-8",
    );
    const { captured, runner } = createRunner(
      JSON.stringify({ type: "agent_message", message: "Brief loaded" }),
    );

    const response = await handleTerminalQueryHttpPayload(
      {
        prompt: "Inspect the project",
        mode: "ask",
      },
      { projectRoot, terminalQueryService: createTerminalQueryService(runner) },
    );

    expect(response.statusCode).toBe(200);
    const prompt = captured[0]?.args.at(-1);
    expect(prompt).toContain("Read this project brief before starting:");
    expect(prompt).toContain(join(projectRoot, "blueprint", "brief.md"));
    expect(prompt).toContain("Inspect the project");
  });

  it("continues the same Codex session for repeated frontend chat messages", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-chat-session-"));
    await mkdir(join(projectRoot, "blueprint"), { recursive: true });
    await writeFile(
      join(projectRoot, "blueprint", "brief.md"),
      "# Project Blueprint Brief\n",
      "utf-8",
    );
    const { captured, runner } = createRunnerSequence([
      [
        JSON.stringify({
          type: "thread.started",
          thread_id: "019dc536-7683-7370-b01a-f9633e9281c1",
        }),
        JSON.stringify({ type: "agent_message", message: "First answer" }),
      ].join("\n"),
      JSON.stringify({ type: "agent_message", message: "Second answer" }),
    ]);
    const service = createTerminalQueryService(runner);

    const first = await handleTerminalQueryHttpPayload(
      {
        chatId: "chat_1",
        prompt: "First",
      },
      { projectRoot, terminalQueryService: service },
    );
    const second = await handleTerminalQueryHttpPayload(
      {
        chatId: "chat_1",
        prompt: "Second",
      },
      { projectRoot, terminalQueryService: service },
    );

    expect(first.payload).toMatchObject({
      answer: "First answer",
      session: {
        chatId: "chat_1",
      },
    });
    expect(second.payload).toMatchObject({
      answer: "Second answer",
      session: {
        chatId: "chat_1",
      },
    });
    expect(first.payload).not.toHaveProperty("providerSessionId");
    expect(second.payload).not.toHaveProperty("providerSessionId");
    expect(captured[0]?.args.at(-1)).toContain("Read this project brief before starting:");
    expect(captured[1]?.args).toEqual([
      "exec",
      "-c",
      'mcp_servers.mindmap.default_tools_approval_mode="approve"',
      "--sandbox",
      "workspace-write",
      "resume",
      "--json",
      "019dc536-7683-7370-b01a-f9633e9281c1",
      "Second",
    ]);
  });

  it("does not generate a Markdown brief from blueprint-output during terminal requests", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-stale-brief-"));
    await writeFile(
      join(projectRoot, "blueprint-output.json"),
      JSON.stringify(createBlueprintOutput(), null, 2),
      "utf-8",
    );
    const { captured, runner } = createRunner(
      JSON.stringify({ type: "agent_message", message: "Ran despite stale blueprint" }),
    );

    const response = await handleTerminalQueryHttpPayload(
      {
        prompt: "Inspect runtime",
        mode: "ask",
      },
      { projectRoot, terminalQueryService: createTerminalQueryService(runner) },
    );

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      answer: "Ran despite stale blueprint",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.args.at(-1)).toContain("Inspect runtime");
    expect(captured[0]?.args.at(-1)).not.toContain("Read this project brief before starting:");
    await expect(readFile(join(projectRoot, "blueprint", "brief.md"), "utf-8")).rejects.toThrow();
  });

  it("returns JSON validation errors without invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-validation-"));
    const { captured, runner } = createRunner("");

    const response = await handleTerminalQueryHttpPayload(
      { prompt: "" },
      { projectRoot, terminalQueryService: createTerminalQueryService(runner) },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: "prompt is required" });
    expect(captured).toHaveLength(0);
  });

  it("rejects cwd outside the configured project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "terminal-http-cwd-"));
    const { captured, runner } = createRunner("");

    const response = await handleTerminalQueryHttpPayload(
      { prompt: "Try outside", cwd: tmpdir() },
      { projectRoot, terminalQueryService: createTerminalQueryService(runner) },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: "cwd must be inside projectRoot" });
    expect(captured).toHaveLength(0);
  });
});
