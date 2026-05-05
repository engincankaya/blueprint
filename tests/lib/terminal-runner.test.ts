import { describe, expect, it } from "vitest";
import { runTerminalCommand } from "../../src/lib/terminal-runner.js";

describe("runTerminalCommand", () => {
  it("streams stdout and stderr chunks while collecting the final output", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await runTerminalCommand({
      file: process.execPath,
      args: [
        "-e",
        "process.stdout.write('out-one\\n'); process.stderr.write('err-one\\n'); process.stdout.write('out-two\\n');",
      ],
      cwd: process.cwd(),
      timeoutMs: 1_000,
      onStdout: (chunk) => stdoutChunks.push(chunk),
      onStderr: (chunk) => stderrChunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("out-one");
    expect(result.stdout).toContain("out-two");
    expect(result.stderr).toContain("err-one");
    expect(stdoutChunks.join("")).toBe(result.stdout);
    expect(stderrChunks.join("")).toBe(result.stderr);
  });
});
