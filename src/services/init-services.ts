import { CodexTerminalProvider } from "../cli-providers/codex-terminal-provider.js";
import { runTerminalCommand } from "../lib/terminal-runner.js";
import { BlueprintGroupService } from "./blueprint-group-service.js";
import { TerminalQueryService } from "./terminal-query-service.js";

export interface ApiServices {
  terminalQuery: TerminalQueryService;
  blueprintGroup: BlueprintGroupService;
}

export interface InitServicesOptions {
  logger?: (message: string) => void;
}

export function initServices(options: InitServicesOptions): ApiServices {
  const terminalQueryService = new TerminalQueryService(runTerminalCommand, [
    new CodexTerminalProvider(),
  ]);

  return {
    terminalQuery: terminalQueryService,
    blueprintGroup: new BlueprintGroupService(),
  };
}
