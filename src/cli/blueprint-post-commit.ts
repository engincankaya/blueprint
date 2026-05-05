#!/usr/bin/env node
import { cwd, exit } from "node:process";
import { pathToFileURL } from "node:url";
import { CodexTerminalProvider } from "../cli-providers/codex-terminal-provider.js";
import { runTerminalCommand } from "../lib/terminal-runner.js";
import { BlueprintPostCommitService } from "../services/post-commit/blueprint-post-commit-service.js";
import { TerminalPostCommitLlmRunner } from "../services/post-commit/terminal-llm-runner.js";
import { TerminalQueryService } from "../services/terminal-query-service.js";

export interface BlueprintPostCommitCliArgs {
  projectRoot: string;
  before: string;
  after: string;
  runLlm: boolean;
  timeoutMs?: number;
  printPrompt: boolean;
}

export function parseBlueprintPostCommitCliArgs(argv: string[]): BlueprintPostCommitCliArgs {
  const args = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-llm") {
      args.set("runLlm", false);
      continue;
    }
    if (arg === "--print-prompt") {
      args.set("printPrompt", true);
      continue;
    }
    if (!arg?.startsWith("--")) {
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    args.set(arg.slice(2), value);
    index += 1;
  }

  return {
    projectRoot: stringArg(args.get("project-root"), cwd()),
    before: stringArg(args.get("before"), "HEAD~1"),
    after: stringArg(args.get("after"), "HEAD"),
    runLlm: args.get("runLlm") !== false,
    printPrompt: args.get("printPrompt") === true,
    ...(args.has("timeout-ms") ? { timeoutMs: numberArg(args.get("timeout-ms"), "timeout-ms") } : {}),
  };
}

async function main(): Promise<void> {
  const args = parseBlueprintPostCommitCliArgs(process.argv.slice(2));
  const terminalQueryService = new TerminalQueryService(runTerminalCommand, [
    new CodexTerminalProvider(),
  ]);
  const llmRunner = new TerminalPostCommitLlmRunner(
    terminalQueryService,
    args.timeoutMs,
  );
  const result = await new BlueprintPostCommitService({
    llmRunner: llmRunner.run,
  }).handle(args);
  if (args.printPrompt) {
    console.log(result.prompt);
  }
  console.error(`Blueprint review written: ${result.reviewPath}`);
}

function stringArg(value: string | boolean | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(value: string | boolean | undefined, name: string): number {
  if (typeof value !== "string") {
    throw new Error(`Missing value for ${name}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  });
}
