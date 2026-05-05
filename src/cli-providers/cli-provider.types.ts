/**
 * Shared contracts for terminal-backed AI CLI providers.
 */
import type {
  TerminalCommandRequest,
  TerminalCommandResult,
} from "../lib/terminal-runner.js";

export type TerminalQueryProviderName = "codex";
export type TerminalQueryMode = "ask" | "edit";

export interface TerminalQueryProviderRequest {
  prompt: string;
  cwd: string;
  mode: TerminalQueryMode;
  timeoutMs: number;
  providerSessionId?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface TerminalProviderParseResult {
  providerSessionId?: string;
  messages: string[];
  runDetails: {
    providerSessionId?: string;
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
    parseErrors: string[];
    toolCallCancelled: boolean;
  };
}

export type TerminalProviderStreamEvent =
  | {
    type: "delta";
    data: {
      text: string;
    };
  }
  | {
    type: "command";
    data: TerminalProviderParseResult["runDetails"]["commands"][number];
  }
  | {
    type: "file";
    data: TerminalProviderParseResult["runDetails"]["files"][number];
  }
  | {
    type: "tool";
    data: TerminalProviderParseResult["runDetails"]["tools"][number];
  }
  | {
    type: "plan";
    data: TerminalProviderParseResult["runDetails"]["plans"][number];
  }
  | {
    type: "usage";
    data: NonNullable<TerminalProviderParseResult["runDetails"]["usage"]>;
  };

export interface TerminalQueryProvider {
  readonly name: TerminalQueryProviderName;
  buildCommand(request: TerminalQueryProviderRequest): TerminalCommandRequest;
  parseResult(result: TerminalCommandResult): TerminalProviderParseResult;
  parseStreamLine?(line: string): TerminalProviderStreamEvent[];
}
