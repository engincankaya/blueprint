import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalQueryService } from "../../src/services/terminal-query-service.js";
import { CodexTerminalProvider } from "../../src/cli-providers/codex-terminal-provider.js";
import { parseJsonToolResult } from "../../src/types.js";

interface TerminalQueryResponse {
  provider: "codex";
  mode: "ask" | "edit";
  success: boolean;
  answer: string;
  messages: string[];
  runDetails: {
    rawJsonlLineCount: number;
    rawMessages: string[];
    timeline: Array<{
      type: string;
      summary: string;
    }>;
    commands: Array<{
      command: string;
      status?: string;
      exitCode?: number;
    }>;
    files: Array<{
      path: string;
      action?: string;
    }>;
    tools: Array<{
      name: string;
      kind: string;
      status?: string;
      error?: string;
    }>;
    plans: Array<{
      step: string;
      status?: string;
    }>;
    usage?: {
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      reasoningOutputTokens?: number;
    };
    toolCallCancelled?: boolean;
  };
  session?: {
    chatId?: string;
  };
}

interface CapturedRun {
  file: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

function createRunner(stdout: string, exitCode = 0): {
  captured: CapturedRun[];
  runner: (request: CapturedRun) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    timedOut: boolean;
  }>;
} {
  const captured: CapturedRun[] = [];
  return {
    captured,
    runner: async (request: CapturedRun) => {
      captured.push(request);
      return {
        stdout,
        stderr: "",
        exitCode,
        durationMs: 12,
        timedOut: false,
      };
    },
  };
}

function createRunnerSequence(stdoutByRun: string[]): {
  captured: CapturedRun[];
  runner: ReturnType<typeof createRunner>["runner"];
} {
  const captured: CapturedRun[] = [];
  return {
    captured,
    runner: async (request: CapturedRun) => {
      captured.push(request);
      return {
        stdout: stdoutByRun[captured.length - 1] ?? "",
        stderr: "",
        exitCode: 0,
        durationMs: 12,
        timedOut: false,
      };
    },
  };
}

function createTerminalQueryService(
  runner: ReturnType<typeof createRunner>["runner"],
): TerminalQueryService {
  return new TerminalQueryService(runner, [new CodexTerminalProvider()]);
}

describe("terminal query service", () => {
  it("streams assistant text and run-detail events before returning the final response", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-stream-"));
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_stream_1" }),
      JSON.stringify({ type: "agent_message", message: "I will inspect it." }),
      JSON.stringify({
        type: "item.started",
        item: {
          type: "command_execution",
          command: "rg TerminalQueryService src",
          status: "in_progress",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          name: "blueprint.task_context",
          status: "completed",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          path: "src/server/routes/index.ts",
          action: "modified",
        },
      }),
      JSON.stringify({
        type: "agent_message",
        message: "Done.",
        plan: [{ step: "Add streaming endpoint", status: "completed" }],
      }),
    ].join("\n");
    const streamed: Array<{ type: string; data: unknown }> = [];
    const { runner } = createRunner(stdout);
    const streamingRunner: typeof runner = async (request) => {
      request.onStdout?.(stdout);
      return runner(request);
    };

    const result = await createTerminalQueryService(streamingRunner).queryStream(
      {
        prompt: "Stream the answer",
        projectRoot: rootPath,
        chatId: "chat_stream",
        mode: "ask",
      },
      {
        onEvent: (event) => streamed.push(event),
      },
    );

    expect(result.ok).toBe(true);
    expect(streamed).toEqual([
      { type: "delta", data: { text: "I will inspect it." } },
      {
        type: "command",
        data: {
          command: "rg TerminalQueryService src",
          status: "in_progress",
        },
      },
      {
        type: "tool",
        data: {
          name: "blueprint.task_context",
          kind: "mcp_tool_call",
          status: "completed",
        },
      },
      {
        type: "file",
        data: {
          path: "src/server/routes/index.ts",
          action: "modified",
        },
      },
      { type: "delta", data: { text: "Done." } },
      {
        type: "plan",
        data: {
          step: "Add streaming endpoint",
          status: "completed",
        },
      },
    ]);
    expect(result.payload).toMatchObject({
      answer: "I will inspect it.\nDone.",
      session: { chatId: "chat_stream" },
      runDetails: {
        commands: [{ command: "rg TerminalQueryService src", status: "in_progress" }],
        files: [{ path: "src/server/routes/index.ts", action: "modified" }],
        tools: [{ name: "blueprint.task_context", kind: "mcp_tool_call", status: "completed" }],
        plans: [{ step: "Add streaming endpoint", status: "completed" }],
      },
    });
  });

  it("runs Codex in edit mode by default and returns only JSONL message content", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-"));
    const { captured, runner } = createRunner([
      JSON.stringify({ type: "agent_message", message: "I will inspect the project." }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      }),
      JSON.stringify({ type: "command_execution", command: "npm test" }),
    ].join("\n"));

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Update the project",
        projectRoot: rootPath,
      }, runner),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      file: "codex",
      args: [
        "exec",
        "-c",
        'mcp_servers.blueprint.default_tools_approval_mode="approve"',
        "--sandbox",
        "workspace-write",
        "--json",
        "Update the project",
      ],
      cwd: rootPath,
    });
    expect(response).toMatchObject({
      provider: "codex",
      mode: "edit",
      success: true,
      messages: ["I will inspect the project.", "Done."],
      answer: "I will inspect the project.\nDone.",
      runDetails: {
        rawJsonlLineCount: 3,
        rawMessages: ["I will inspect the project.", "Done."],
      },
    });
  });

  it("marks cancelled MCP tool calls as unsuccessful even when Codex exits cleanly", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-cancelled-tool-"));
    const { runner } = createRunner([
      JSON.stringify({
        type: "mcp_tool_call",
        name: "blueprint.group.update",
        status: "cancelled",
        error: "The MCP tool call was cancelled by the user",
      }),
      JSON.stringify({
        type: "agent_message",
        message: "The MCP tool call was cancelled by the user.",
      }),
    ].join("\n"));

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Assign the file",
        projectRoot: rootPath,
      }, runner),
    );

    expect(response.success).toBe(false);
    expect(response.runDetails.tools).toEqual([
      {
        name: "blueprint.group.update",
        kind: "mcp_tool_call",
        status: "cancelled",
        error: "The MCP tool call was cancelled by the user",
      },
    ]);
    expect(response.runDetails).toMatchObject({
      toolCallCancelled: true,
    });
  });

  it("runs Codex without full-auto in ask mode", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-ask-"));
    const { captured, runner } = createRunner(
      JSON.stringify({ type: "agent_message", message: "This is the explanation." }),
    );

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Explain only",
        projectRoot: rootPath,
        mode: "ask",
      }, runner),
    );

    expect(captured[0]?.args).toEqual([
      "exec",
      "-c",
      'mcp_servers.blueprint.default_tools_approval_mode="approve"',
      "--json",
      "Explain only",
    ]);
    expect(response.mode).toBe("ask");
    expect(response.answer).toBe("This is the explanation.");
  });

  it("rejects cwd values outside the project root", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-root-"));
    const { runner } = createRunner("");

    await expect(async () =>
      parseJsonToolResult<TerminalQueryResponse>(
        await createTerminalQueryService(runner).handle({
          prompt: "Try outside",
          projectRoot: rootPath,
          cwd: tmpdir(),
        }, runner),
      ),
    ).rejects.toThrow("cwd must be inside projectRoot");
  });

  it("normalizes Codex JSONL command, file, tool, web search, and plan events", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-events-"));
    const { runner } = createRunner([
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
          type: "command_execution",
          command: "npm test",
          status: "completed",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          path: "src/index.ts",
          action: "modified",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          name: "blueprint.task_context",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "web_search",
          query: "codex json output",
        },
      }),
      JSON.stringify({
        type: "plan.updated",
        plan: [
          { step: "Write failing tests", status: "completed" },
          { step: "Implement parser", status: "in_progress" },
        ],
      }),
    ].join("\n"));

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Normalize events",
        projectRoot: rootPath,
      }, runner),
    );

    expect(response.runDetails.commands).toEqual([
      {
        command: "npm test",
        status: "in_progress",
      },
      {
        command: "npm test",
        status: "completed",
        exitCode: 0,
      },
    ]);
    expect(response.runDetails.files).toEqual([
      {
        path: "src/index.ts",
        action: "modified",
      },
    ]);
    expect(response.runDetails.tools).toEqual([
      {
        name: "blueprint.task_context",
        kind: "mcp_tool_call",
      },
      {
        name: "codex json output",
        kind: "web_search",
      },
    ]);
    expect(response.runDetails.plans).toEqual([
      { step: "Write failing tests", status: "completed" },
      { step: "Implement parser", status: "in_progress" },
    ]);
    expect(response.runDetails.timeline.map((entry) => entry.summary)).toEqual([
      "command npm test in_progress",
      "command npm test completed",
      "file src/index.ts modified",
      "tool blueprint.task_context",
      "web search codex json output",
      "plan Write failing tests completed",
      "plan Implement parser in_progress",
    ]);
  });

  it("parses the observed real Codex JSONL smoke output shape", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-real-shape-"));
    const { runner } = createRunner([
      JSON.stringify({
        type: "thread.started",
        thread_id: "019dc536-7683-7370-b01a-f9633e9281c1",
      }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "terminal query smoke ok",
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 24776,
          cached_input_tokens: 16256,
          output_tokens: 8,
          reasoning_output_tokens: 0,
        },
      }),
    ].join("\n"));

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Smoke",
        projectRoot: rootPath,
        mode: "ask",
      }, runner),
    );

    expect(response.messages).toEqual(["terminal query smoke ok"]);
    expect(response.answer).toBe("terminal query smoke ok");
    expect(response).not.toHaveProperty("providerSessionId");
    expect(response.runDetails).not.toHaveProperty("providerSessionId");
    expect(response.runDetails.usage).toEqual({
      inputTokens: 24776,
      cachedInputTokens: 16256,
      outputTokens: 8,
      reasoningOutputTokens: 0,
    });
  });

  it("parses the observed real Codex todo_list and command execution shape", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-real-plan-"));
    const { runner } = createRunner([
      JSON.stringify({
        type: "item.started",
        item: {
          id: "item_0",
          type: "todo_list",
          items: [
            { text: "Inspect package metadata", completed: false },
            { text: "Return compact JSON summary", completed: false },
          ],
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "command_execution",
          command: "/bin/zsh -lc \"sed -n '1,220p' package.json\"",
          aggregated_output: "{\n  \"name\": \"blueprint-mcp-server\"\n}\n",
          exit_code: 0,
          status: "completed",
        },
      }),
      JSON.stringify({
        type: "item.updated",
        item: {
          id: "item_0",
          type: "todo_list",
          items: [
            { text: "Inspect package metadata", completed: true },
            { text: "Return compact JSON summary", completed: false },
          ],
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_3",
          type: "agent_message",
          text: "{\"packageName\":\"blueprint-mcp-server\"}",
        },
      }),
    ].join("\n"));

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Inspect package",
        projectRoot: rootPath,
        mode: "ask",
      }, runner),
    );

    expect(response.runDetails.commands).toEqual([
      {
        command: "/bin/zsh -lc \"sed -n '1,220p' package.json\"",
        status: "completed",
        exitCode: 0,
      },
    ]);
    expect(response.runDetails.plans).toEqual([
      { step: "Inspect package metadata", status: "pending" },
      { step: "Return compact JSON summary", status: "pending" },
      { step: "Inspect package metadata", status: "completed" },
      { step: "Return compact JSON summary", status: "pending" },
    ]);
    expect(response.runDetails.timeline.map((entry) => entry.summary)).toEqual([
      "plan Inspect package metadata pending",
      "plan Return compact JSON summary pending",
      "command /bin/zsh -lc \"sed -n '1,220p' package.json\" completed",
      "plan Inspect package metadata completed",
      "plan Return compact JSON summary pending",
    ]);
  });

  it("parses observed real Codex file_change changes arrays and web_search events", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-real-file-change-"));
    const { runner } = createRunner([
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_4",
          type: "file_change",
          changes: [
            {
              path: "/repo/src/codex-smoke-temp.ts",
              kind: "add",
            },
          ],
          status: "completed",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_8",
          type: "web_search",
          query: "site:developers.openai.com codex cli json output",
          action: {
            type: "search",
            query: "site:developers.openai.com codex cli json output",
          },
        },
      }),
    ].join("\n"));

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Parse file change",
        projectRoot: rootPath,
        mode: "ask",
      }, runner),
    );

    expect(response.runDetails.files).toEqual([
      {
        path: "/repo/src/codex-smoke-temp.ts",
        action: "add",
      },
    ]);
    expect(response.runDetails.tools).toEqual([
      {
        name: "site:developers.openai.com codex cli json output",
        kind: "web_search",
      },
    ]);
    expect(response.runDetails.timeline.map((entry) => entry.summary)).toEqual([
      "file /repo/src/codex-smoke-temp.ts add",
      "web search site:developers.openai.com codex cli json output",
    ]);
  });

  it("parses observed real Codex plan text from agent messages", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-agent-plan-"));
    const { runner } = createRunner(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: [
            "Plan:",
            "1. Check the current contents of `src/codex-smoke-temp.ts`.",
            "2. Add only the requested export.",
            "3. Inspect the file with a shell command.",
          ].join("\n"),
        },
      }),
    );

    const response = parseJsonToolResult<TerminalQueryResponse>(
      await createTerminalQueryService(runner).handle({
        prompt: "Plan text",
        projectRoot: rootPath,
        mode: "ask",
      }, runner),
    );

    expect(response.runDetails.plans).toEqual([
      { step: "Check the current contents of `src/codex-smoke-temp.ts`.", status: "pending" },
      { step: "Add only the requested export.", status: "pending" },
      { step: "Inspect the file with a shell command.", status: "pending" },
    ]);
  });

  it("resumes Codex with the provider session for repeated frontend chat messages", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "terminal-query-chat-session-"));
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

    const first = parseJsonToolResult<TerminalQueryResponse>(
      await service.handle({
        prompt: "First",
        projectRoot: rootPath,
        chatId: "chat_1",
      }, runner),
    );
    const second = parseJsonToolResult<TerminalQueryResponse>(
      await service.handle({
        prompt: "Second",
        projectRoot: rootPath,
        chatId: "chat_1",
      }, runner),
    );

    expect(first.session).toEqual({
      chatId: "chat_1",
    });
    expect(second.session).toEqual({
      chatId: "chat_1",
    });
    expect(first).not.toHaveProperty("providerSessionId");
    expect(second).not.toHaveProperty("providerSessionId");
    expect(first.runDetails).not.toHaveProperty("providerSessionId");
    expect(second.runDetails).not.toHaveProperty("providerSessionId");
    expect(captured[0]?.args).toEqual([
      "exec",
      "-c",
      'mcp_servers.blueprint.default_tools_approval_mode="approve"',
      "--sandbox",
      "workspace-write",
      "--json",
      "First",
    ]);
    expect(captured[1]?.args).toEqual([
      "exec",
      "-c",
      'mcp_servers.blueprint.default_tools_approval_mode="approve"',
      "--sandbox",
      "workspace-write",
      "resume",
      "--json",
      "019dc536-7683-7370-b01a-f9633e9281c1",
      "Second",
    ]);
  });
});
