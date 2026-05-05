import { parseJsonToolResult } from "../../types.js";
import { type TerminalQueryService } from "../terminal-query-service.js";
import { type BlueprintPostCommitLlmRunner } from "./blueprint-post-commit-service.js";

export class TerminalPostCommitLlmRunner {
  constructor(
    private readonly terminalQueryService: TerminalQueryService,
    private readonly timeoutMs?: number,
  ) {}

  run: BlueprintPostCommitLlmRunner = async (prompt, args) => {
    const result = parseJsonToolResult<{
      answer?: string;
      messages?: string[];
      runDetails?: {
        commands?: Array<{ command: string }>;
        files?: Array<{ path: string; action?: string }>;
      };
    }>(
      await this.terminalQueryService.handle({
        prompt,
        projectRoot: args.projectRoot,
        mode: "edit",
        timeoutMs: this.timeoutMs,
      }),
    );

    return {
      response: result.answer ?? result.messages?.join("\n") ?? "",
      ...(result.runDetails ? { runDetails: result.runDetails } : {}),
    };
  };
}
