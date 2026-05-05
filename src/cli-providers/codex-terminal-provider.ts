/**
 * Codex CLI provider for terminal query execution and JSONL parsing.
 */
import type { TerminalCommandResult, TerminalCommandRequest } from "../lib/terminal-runner.js";
import type {
  TerminalProviderParseResult,
  TerminalProviderStreamEvent,
  TerminalQueryMode,
  TerminalQueryProvider,
  TerminalQueryProviderRequest,
} from "./cli-provider.types.js";

interface CodexJsonlParseResult {
  providerSessionId?: string;
  rawJsonlLineCount: number;
  messages: string[];
  timeline: TerminalProviderParseResult["runDetails"]["timeline"];
  commands: TerminalProviderParseResult["runDetails"]["commands"];
  files: TerminalProviderParseResult["runDetails"]["files"];
  tools: TerminalProviderParseResult["runDetails"]["tools"];
  plans: TerminalProviderParseResult["runDetails"]["plans"];
  usage?: TerminalProviderParseResult["runDetails"]["usage"];
  parseErrors: string[];
}

export class CodexTerminalProvider implements TerminalQueryProvider {
  readonly name = "codex" as const;

  private readonly parser = new CodexJsonlParser();

  buildCommand(request: TerminalQueryProviderRequest): TerminalCommandRequest {
    return {
      file: "codex",
      args: this.buildArgs(request.prompt, request.mode, request.providerSessionId),
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      onStdout: request.onStdout,
      onStderr: request.onStderr,
    };
  }

  parseResult(result: TerminalCommandResult): TerminalProviderParseResult {
    const parsed = this.parser.parse(result.stdout);
    const toolCallCancelled = this.hasToolCallCancellation(parsed, result.stderr);

    return {
      messages: parsed.messages,
      providerSessionId: parsed.providerSessionId,
      runDetails: {
        providerSessionId: parsed.providerSessionId,
        rawJsonlLineCount: parsed.rawJsonlLineCount,
        rawMessages: parsed.messages,
        timeline: parsed.timeline,
        commands: parsed.commands,
        files: parsed.files,
        tools: parsed.tools,
        plans: parsed.plans,
        usage: parsed.usage,
        parseErrors: parsed.parseErrors,
        toolCallCancelled,
      },
    };
  }

  parseStreamLine(line: string): TerminalProviderStreamEvent[] {
    return this.parser.parseStreamLine(line);
  }

  private buildArgs(
    prompt: string,
    mode: TerminalQueryMode,
    providerSessionId?: string,
  ): string[] {
    const mcpApprovalOverrides = [
      "-c",
      'mcp_servers.mindmap.default_tools_approval_mode="approve"',
    ];
    const modeArgs = mode === "ask" ? [] : ["--sandbox", "workspace-write"];
    if (providerSessionId) {
      return [
        "exec",
        ...mcpApprovalOverrides,
        ...modeArgs,
        "resume",
        "--json",
        providerSessionId,
        prompt,
      ];
    }
    return ["exec", ...mcpApprovalOverrides, ...modeArgs, "--json", prompt];
  }

  private hasToolCallCancellation(
    parsed: CodexJsonlParseResult,
    stderr: string,
  ): boolean {
    const haystack = [
      ...parsed.messages,
      ...parsed.tools.map((tool) => [tool.status, tool.error].filter(Boolean).join(" ")),
      stderr,
    ].join("\n").toLowerCase();

    return /tool call was cancell?ed by the user/.test(haystack)
      || /mcp tool call.*cancell?ed/.test(haystack)
      || /cancell?ed by the user/.test(haystack);
  }
}

class CodexJsonlParser {
  parse(stdout: string): CodexJsonlParseResult {
    const messages: string[] = [];
    const timeline: CodexJsonlParseResult["timeline"] = [];
    const commands: CodexJsonlParseResult["commands"] = [];
    const files: CodexJsonlParseResult["files"] = [];
    const tools: CodexJsonlParseResult["tools"] = [];
    const plans: CodexJsonlParseResult["plans"] = [];
    let providerSessionId: string | undefined;
    let usage: CodexJsonlParseResult["usage"];
    const parseErrors: string[] = [];
    const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as unknown;
        providerSessionId ??= this.extractProviderSessionId(event);
        messages.push(...this.extractMessageTexts(event));
        const normalized = this.normalizeEvent(event);
        timeline.push(...normalized.timeline);
        commands.push(...normalized.commands);
        files.push(...normalized.files);
        tools.push(...normalized.tools);
        plans.push(...normalized.plans);
        usage = this.mergeUsage(usage, normalized.usage);
      } catch (err) {
        parseErrors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return {
      rawJsonlLineCount: lines.length,
      providerSessionId,
      messages,
      timeline,
      commands,
      files,
      tools,
      plans,
      usage,
      parseErrors,
    };
  }

  parseStreamLine(line: string): TerminalProviderStreamEvent[] {
    if (!line.trim()) {
      return [];
    }

    const event = JSON.parse(line) as unknown;
    const normalized = this.normalizeEvent(event);
    return [
      ...this.extractMessageTexts(event).map((text) => ({
        type: "delta" as const,
        data: { text },
      })),
      ...normalized.commands.map((command) => ({
        type: "command" as const,
        data: command,
      })),
      ...normalized.files.map((file) => ({
        type: "file" as const,
        data: file,
      })),
      ...normalized.tools.map((tool) => ({
        type: "tool" as const,
        data: tool,
      })),
      ...normalized.plans.map((plan) => ({
        type: "plan" as const,
        data: plan,
      })),
      ...(normalized.usage ? [{
        type: "usage" as const,
        data: normalized.usage,
      }] : []),
    ];
  }

  private extractMessageTexts(value: unknown): string[] {
    if (!this.isRecord(value)) {
      return [];
    }

    const texts: string[] = [];
    if (typeof value.message === "string") {
      texts.push(value.message);
    }

    if (this.isMessageLike(value)) {
      texts.push(...this.extractMessagePayload(value));
    }

    if (this.isRecord(value.item) && this.isMessageLike(value.item)) {
      texts.push(...this.extractMessagePayload(value.item));
    }

    return this.unique(texts.filter((text) => text.length > 0));
  }

  private extractProviderSessionId(value: unknown): string | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    if (value.type === "thread.started" && typeof value.thread_id === "string") {
      return value.thread_id;
    }

    if (typeof value.session_id === "string") {
      return value.session_id;
    }

    return undefined;
  }

  private isMessageLike(value: Record<string, unknown>): boolean {
    return value.role === "assistant"
      || value.type === "message"
      || (typeof value.type === "string" && value.type.includes("message"));
  }

  private extractMessagePayload(value: Record<string, unknown>): string[] {
    const texts: string[] = [];

    if (typeof value.text === "string") {
      texts.push(value.text);
    }
    if (typeof value.content === "string") {
      texts.push(value.content);
    }
    if (typeof value.delta === "string") {
      texts.push(value.delta);
    }
    if (Array.isArray(value.content)) {
      for (const item of value.content) {
        if (!this.isRecord(item)) continue;
        if (typeof item.text === "string") {
          texts.push(item.text);
        } else if (typeof item.content === "string") {
          texts.push(item.content);
        }
      }
    }

    return texts;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private normalizeEvent(event: unknown): Pick<
    CodexJsonlParseResult,
    "timeline" | "commands" | "files" | "tools" | "plans" | "usage"
  > {
    const empty = {
      timeline: [],
      commands: [],
      files: [],
      tools: [],
      plans: [],
      usage: undefined,
    };
    if (!this.isRecord(event)) {
      return empty;
    }

    const item = this.isRecord(event.item) ? event.item : event;
    const commands = this.extractCommand(item);
    const files = this.extractFile(item);
    const tools = this.extractTool(item);
    const plans = [
      ...this.extractPlans(event),
      ...this.extractTodoListPlans(item),
      ...this.extractAgentMessagePlans(item),
    ];
    const usage = this.extractUsage(event);
    const timeline = [
      ...commands.map((command) => ({
        type: "command",
        summary: ["command", command.command, command.status].filter(Boolean).join(" "),
      })),
      ...files.map((file) => ({
        type: "file",
        summary: ["file", file.path, file.action].filter(Boolean).join(" "),
      })),
      ...tools.map((tool) => ({
        type: tool.kind,
        summary: tool.kind === "web_search"
          ? `web search ${tool.name}`
          : `tool ${tool.name}`,
      })),
      ...plans.map((plan) => ({
        type: "plan",
        summary: ["plan", plan.step, plan.status].filter(Boolean).join(" "),
      })),
    ];

    return {
      timeline,
      commands,
      files,
      tools,
      plans,
      usage,
    };
  }

  private extractCommand(
    item: Record<string, unknown>,
  ): CodexJsonlParseResult["commands"] {
    if (item.type !== "command_execution") {
      return [];
    }
    const command = this.stringField(item, ["command", "cmd"]);
    if (!command) {
      return [];
    }
    const status = this.stringField(item, ["status"]);
    const exitCode = this.numberField(item, ["exitCode", "exit_code"]);
    return [{
      command,
      ...(status ? { status } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    }];
  }

  private extractFile(
    item: Record<string, unknown>,
  ): CodexJsonlParseResult["files"] {
    if (!["file_change", "file_edit", "file_diff"].includes(String(item.type))) {
      return [];
    }
    if (Array.isArray(item.changes)) {
      return item.changes
        .map((change) => {
          if (!this.isRecord(change)) {
            return undefined;
          }
          const path = this.stringField(change, ["path", "file", "filePath", "file_path"]);
          if (!path) {
            return undefined;
          }
          const action = this.stringField(change, ["kind", "action", "operation", "status"]);
          return {
            path,
            ...(action ? { action } : {}),
          };
        })
        .filter((file): file is CodexJsonlParseResult["files"][number] => Boolean(file));
    }
    const path = this.stringField(item, ["path", "file", "filePath", "file_path"]);
    if (!path) {
      return [];
    }
    const action = this.stringField(item, ["action", "operation", "status"]);
    return [{
      path,
      ...(action ? { action } : {}),
    }];
  }

  private extractTool(
    item: Record<string, unknown>,
  ): CodexJsonlParseResult["tools"] {
    const kind = String(item.type);
    if (kind === "mcp_tool_call") {
      const name = this.stringField(item, ["name", "tool", "toolName"]);
      const status = this.stringField(item, ["status", "state", "outcome"]);
      const error = this.stringField(item, ["error", "message", "reason"]);
      return name
        ? [{
          name,
          kind,
          ...(status ? { status } : {}),
          ...(error ? { error } : {}),
        }]
        : [];
    }
    if (kind === "web_search") {
      const query = this.stringField(item, ["query", "name"]);
      return query ? [{ name: query, kind }] : [];
    }
    return [];
  }

  private extractPlans(event: Record<string, unknown>): CodexJsonlParseResult["plans"] {
    const plan = event.plan;
    if (!Array.isArray(plan)) {
      return [];
    }
    return plan
      .map((step) => {
        if (!this.isRecord(step)) {
          return undefined;
        }
        const stepText = this.stringField(step, ["step", "text", "description"]);
        if (!stepText) {
          return undefined;
        }
        const status = this.stringField(step, ["status"]);
        return {
          step: stepText,
          ...(status ? { status } : {}),
        };
      })
      .filter((step): step is CodexJsonlParseResult["plans"][number] => Boolean(step));
  }

  private extractTodoListPlans(
    item: Record<string, unknown>,
  ): CodexJsonlParseResult["plans"] {
    if (item.type !== "todo_list" || !Array.isArray(item.items)) {
      return [];
    }

    return item.items
      .map((todo): CodexJsonlParseResult["plans"][number] | undefined => {
        if (!this.isRecord(todo)) {
          return undefined;
        }
        const step = this.stringField(todo, ["text", "step", "description"]);
        if (!step) {
          return undefined;
        }
        const completed = todo.completed;
        return {
          step,
          status: completed === true ? "completed" : "pending",
        };
      })
      .filter((step): step is CodexJsonlParseResult["plans"][number] => Boolean(step));
  }

  private extractAgentMessagePlans(
    item: Record<string, unknown>,
  ): CodexJsonlParseResult["plans"] {
    // TODO: Replace this temporary text heuristic with first-class Codex plan events
    // or a typed transcript schema once we settle the frontend run-details contract.
    if (item.type !== "agent_message") {
      return [];
    }
    const text = this.stringField(item, ["text", "message", "content"]);
    if (!text || !/^Plan:/m.test(text)) {
      return [];
    }

    return text
      .split(/\r?\n/)
      .map((line): CodexJsonlParseResult["plans"][number] | undefined => {
        const match = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
        if (!match) {
          return undefined;
        }
        return {
          step: match[1],
          status: "pending",
        };
      })
      .filter((step): step is CodexJsonlParseResult["plans"][number] => Boolean(step));
  }

  private extractUsage(event: Record<string, unknown>): CodexJsonlParseResult["usage"] {
    if (!this.isRecord(event.usage)) {
      return undefined;
    }
    const inputTokens = this.numberField(event.usage, ["inputTokens", "input_tokens"]);
    const cachedInputTokens = this.numberField(
      event.usage,
      ["cachedInputTokens", "cached_input_tokens"],
    );
    const outputTokens = this.numberField(event.usage, ["outputTokens", "output_tokens"]);
    const reasoningOutputTokens = this.numberField(
      event.usage,
      ["reasoningOutputTokens", "reasoning_output_tokens"],
    );

    return {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    };
  }

  private mergeUsage(
    previous: CodexJsonlParseResult["usage"],
    next: CodexJsonlParseResult["usage"],
  ): CodexJsonlParseResult["usage"] {
    if (!next) {
      return previous;
    }
    return {
      ...previous,
      ...next,
    };
  }

  private stringField(
    value: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const field = value[key];
      if (typeof field === "string" && field.length > 0) {
        return field;
      }
    }
    return undefined;
  }

  private numberField(
    value: Record<string, unknown>,
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const field = value[key];
      if (typeof field === "number") {
        return field;
      }
    }
    return undefined;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }
}
