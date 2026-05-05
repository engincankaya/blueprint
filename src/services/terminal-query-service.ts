/**
 * Terminal AI query service.
 *
 * Internal service for preparing terminal query prompts, selecting the configured
 * CLI provider, and shaping the tool response.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { buildTerminalPromptWithBrief } from "../lib/terminal-prompt.js";
import {
  defaultTerminalTimeoutMs,
  type TerminalCommandRunner,
} from "../lib/terminal-runner.js";
import { type ToolResult, errorResult, jsonResult } from "../types.js";
import type {
  TerminalProviderStreamEvent,
  TerminalQueryMode,
  TerminalQueryProvider,
  TerminalQueryProviderName,
} from "../cli-providers/cli-provider.types.js";

export interface TerminalQueryArgs {
  prompt: string;
  projectRoot: string;
  chatId?: string;
  cwd?: string;
  provider?: TerminalQueryProviderName;
  mode?: TerminalQueryMode;
  timeoutMs?: number;
  includeDebug?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface TerminalQueryRequest {
  projectRoot: string;
  prompt: string;
  chatId?: string;
  provider?: TerminalQueryProviderName;
  mode?: TerminalQueryMode;
  cwd?: string;
  timeoutMs?: number;
  includeDebug?: boolean;
}

export type TerminalQueryResult =
  | {
    ok: true;
    payload: unknown;
  }
  | {
    ok: false;
    payload: unknown;
  };

export interface TerminalQueryStreamCallbacks {
  onEvent: (event: TerminalProviderStreamEvent) => void;
}

const minTimeoutMs = 1_000;
const maxTimeoutMs = 10 * 60_000;

interface TerminalChatSession {
  chatId: string;
  provider: TerminalQueryProviderName;
  providerSessionId: string;
  projectRoot: string;
  cwd: string;
  mode: TerminalQueryMode;
  updatedAt: number;
}

export class TerminalQueryService {
  private readonly providers: Map<TerminalQueryProviderName, TerminalQueryProvider>;
  private readonly chatSessions = new Map<string, TerminalChatSession>();

  constructor(
    private readonly runner: TerminalCommandRunner,
    providers: TerminalQueryProvider[],
  ) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  async query(
    request: TerminalQueryRequest,
    logger?: (message: string) => void,
  ): Promise<TerminalQueryResult> {
    const requestId = Math.random().toString(36).slice(2, 10);
    const startedAt = Date.now();
    const providerName = request.provider ?? "codex";
    const projectRoot = resolve(request.projectRoot);
    const cwd = resolve(request.cwd ?? projectRoot);
    const stdoutLogger = this.createLineLogger((line) => {
      logger?.(`[terminal-http:${requestId}] ${providerName} stdout ${this.summarizeCodexLine(line)}`);
    });
    const stderrLogger = this.createLineLogger((line) => {
      logger?.(`[terminal-http:${requestId}] ${providerName} stderr ${line.slice(0, 500)}`);
    });

    logger?.(
      `[terminal-http:${requestId}] start mode=${String(request.mode ?? "edit")} promptChars=${request.prompt.length}`,
    );

    const prompt = this.findChatSession(providerName, projectRoot, request.chatId)
      ? request.prompt
      : await buildTerminalPromptWithBrief(request.prompt, request.projectRoot);
    const result = await this.handle({
      prompt,
      projectRoot: request.projectRoot,
      ...(request.chatId ? { chatId: request.chatId } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.includeDebug !== undefined ? { includeDebug: request.includeDebug } : {}),
      onStdout: stdoutLogger.write,
      onStderr: stderrLogger.write,
    });
    stdoutLogger.flush();
    stderrLogger.flush();

    const payload = this.parseToolJson(result);
    if (this.isRecord(payload) && typeof payload.error === "string") {
      logger?.(
        `[terminal-http:${requestId}] error durationMs=${Date.now() - startedAt} message=${payload.error}`,
      );
      return { ok: false, payload };
    }

    this.logSuccess(logger, requestId, startedAt, payload);
    return { ok: true, payload };
  }

  async queryStream(
    request: TerminalQueryRequest,
    callbacks: TerminalQueryStreamCallbacks,
    logger?: (message: string) => void,
  ): Promise<TerminalQueryResult> {
    const requestId = Math.random().toString(36).slice(2, 10);
    const startedAt = Date.now();
    const providerName = request.provider ?? "codex";
    const provider = this.providers.get(providerName);
    if (!provider) {
      return { ok: false, payload: { error: `unsupported terminal query provider: ${providerName}` } };
    }
    const projectRoot = resolve(request.projectRoot);
    const stdoutLogger = this.createLineLogger((line) => {
      logger?.(`[terminal-stream:${requestId}] ${providerName} stdout ${this.summarizeCodexLine(line)}`);
    });
    const stderrLogger = this.createLineLogger((line) => {
      logger?.(`[terminal-stream:${requestId}] ${providerName} stderr ${line.slice(0, 500)}`);
    });
    const streamParser = this.createLineLogger((line) => {
      if (!provider.parseStreamLine) {
        return;
      }
      try {
        for (const event of provider.parseStreamLine(line)) {
          callbacks.onEvent(event);
        }
      } catch (err) {
        logger?.(
          `[terminal-stream:${requestId}] stream parse error ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    logger?.(
      `[terminal-stream:${requestId}] start mode=${String(request.mode ?? "edit")} promptChars=${request.prompt.length}`,
    );

    const prompt = this.findChatSession(providerName, projectRoot, request.chatId)
      ? request.prompt
      : await buildTerminalPromptWithBrief(request.prompt, request.projectRoot);
    const result = await this.handle({
      prompt,
      projectRoot: request.projectRoot,
      ...(request.chatId ? { chatId: request.chatId } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.includeDebug !== undefined ? { includeDebug: request.includeDebug } : {}),
      onStdout: (chunk) => {
        stdoutLogger.write(chunk);
        streamParser.write(chunk);
      },
      onStderr: stderrLogger.write,
    });
    stdoutLogger.flush();
    streamParser.flush();
    stderrLogger.flush();

    const payload = this.parseToolJson(result);
    if (this.isRecord(payload) && typeof payload.error === "string") {
      logger?.(
        `[terminal-stream:${requestId}] error durationMs=${Date.now() - startedAt} message=${payload.error}`,
      );
      return { ok: false, payload };
    }

    this.logSuccess(logger, requestId, startedAt, payload);
    return { ok: true, payload };
  }

  async handle(args: TerminalQueryArgs): Promise<ToolResult> {
    const prompt = args.prompt.trim();
    if (!prompt) {
      return errorResult("prompt is required");
    }

    const providerName = args.provider ?? "codex";
    const provider = this.providers.get(providerName);
    if (!provider) {
      return errorResult(`unsupported terminal query provider: ${providerName}`);
    }

    const projectRoot = resolve(args.projectRoot);
    const cwd = resolve(args.cwd ?? projectRoot);
    if (!this.isPathInside(projectRoot, cwd)) {
      return errorResult("cwd must be inside projectRoot");
    }

    // Default is intentionally `edit` for the current product direction.
    // Future UX can flip this to `ask` when analysis-only becomes the safer default.
    const mode = args.mode ?? "edit";
    const timeoutMs = this.clampTimeout(args.timeoutMs);
    const existingSession = this.findChatSession(providerName, projectRoot, args.chatId);
    const command = provider.buildCommand({
      prompt,
      cwd,
      mode,
      timeoutMs,
      ...(existingSession?.providerSessionId
        ? { providerSessionId: existingSession.providerSessionId }
        : {}),
      onStdout: args.onStdout,
      onStderr: args.onStderr,
    });
    const result = await this.runner(command);
    const parsed = provider.parseResult(result);
    const providerSessionId = parsed.providerSessionId ?? existingSession?.providerSessionId;
    const session = args.chatId && providerSessionId
      ? this.upsertChatSession({
        chatId: args.chatId,
        provider: provider.name,
        providerSessionId,
        projectRoot,
        cwd,
        mode,
        updatedAt: Date.now(),
      })
      : undefined;

    return jsonResult({
      provider: provider.name,
      mode,
      success: result.exitCode === 0 && !result.timedOut && !parsed.runDetails.toolCallCancelled,
      answer: parsed.messages.join("\n"),
      messages: parsed.messages,
      runDetails: this.publicRunDetails(parsed.runDetails),
      ...(session
        ? {
          session: {
            chatId: session.chatId,
          },
        }
        : {}),
      execution: {
        cwd,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        stderr: result.stderr,
        ...(args.includeDebug ? { command: command.file, args: command.args } : {}),
      },
    });
  }

  private createLineLogger(onLine: (line: string) => void): {
    write: (chunk: string) => void;
    flush: () => void;
  } {
    let buffer = "";

    return {
      write: (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) {
            onLine(line);
          }
        }
      },
      flush: () => {
        if (buffer.trim()) {
          onLine(buffer);
        }
        buffer = "";
      },
    };
  }

  private summarizeCodexLine(line: string): string {
    try {
      const event = JSON.parse(line) as unknown;
      if (!this.isRecord(event)) {
        return line.slice(0, 500);
      }

      const type = typeof event.type === "string" ? event.type : "unknown";
      const item = this.isRecord(event.item) ? event.item : undefined;
      const itemType = item && typeof item.type === "string" ? item.type : undefined;
      const text =
        typeof event.text === "string"
          ? event.text
          : item && typeof item.text === "string"
            ? item.text
            : undefined;
      const command = item && typeof item.command === "string" ? item.command : undefined;
      const summary = [
        `type=${type}`,
        itemType ? `item=${itemType}` : undefined,
        command ? `command=${command.slice(0, 160)}` : undefined,
        text ? `text=${text.slice(0, 160)}` : undefined,
      ].filter(Boolean).join(" ");
      return summary || line.slice(0, 500);
    } catch {
      return line.slice(0, 500);
    }
  }

  private parseToolJson(result: ToolResult): unknown {
    const text = result.content[0]?.text;
    if (!text) {
      return {};
    }
    return JSON.parse(text) as unknown;
  }

  private logSuccess(
    logger: ((message: string) => void) | undefined,
    requestId: string,
    startedAt: number,
    payload: unknown,
  ): void {
    if (!this.isRecord(payload)) {
      return;
    }

    const execution = this.isRecord(payload.execution) ? payload.execution : {};
    const answer = typeof payload.answer === "string" ? payload.answer : "";
    const stderr = typeof execution.stderr === "string" ? execution.stderr : "";
    const stderrSummary = stderr.trim().replace(/\s+/g, " ").slice(0, 240);
    logger?.(
      [
        `[terminal-http:${requestId}] done`,
        `durationMs=${Date.now() - startedAt}`,
        `exitCode=${String(execution.exitCode ?? "unknown")}`,
        `timedOut=${String(execution.timedOut ?? "unknown")}`,
        `answerChars=${answer.length}`,
        stderrSummary ? `stderr="${stderrSummary}"` : undefined,
      ].filter(Boolean).join(" "),
    );
  }

  private clampTimeout(timeoutMs: number | undefined): number {
    if (timeoutMs === undefined) {
      return defaultTerminalTimeoutMs;
    }
    return Math.min(Math.max(timeoutMs, minTimeoutMs), maxTimeoutMs);
  }

  private publicRunDetails(
    runDetails: ReturnType<TerminalQueryProvider["parseResult"]>["runDetails"],
  ): ReturnType<TerminalQueryProvider["parseResult"]>["runDetails"] {
    const { providerSessionId: _providerSessionId, ...publicDetails } = runDetails;
    return publicDetails;
  }

  private findChatSession(
    provider: TerminalQueryProviderName,
    projectRoot: string,
    chatId: string | undefined,
  ): TerminalChatSession | undefined {
    if (!chatId) {
      return undefined;
    }
    return this.chatSessions.get(this.chatSessionKey(provider, projectRoot, chatId));
  }

  private upsertChatSession(session: TerminalChatSession): TerminalChatSession {
    this.chatSessions.set(
      this.chatSessionKey(session.provider, session.projectRoot, session.chatId),
      session,
    );
    return session;
  }

  private chatSessionKey(
    provider: TerminalQueryProviderName,
    projectRoot: string,
    chatId: string,
  ): string {
    return `${provider}:${projectRoot}:${chatId}`;
  }

  private isPathInside(rootPath: string, candidatePath: string): boolean {
    const rel = relative(rootPath, candidatePath);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
