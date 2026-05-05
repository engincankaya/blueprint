import { spawn } from "node:child_process";

export interface TerminalCommandRequest {
  file: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface TerminalCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export type TerminalCommandRunner = (
  request: TerminalCommandRequest,
) => Promise<TerminalCommandResult>;

export const defaultTerminalTimeoutMs = 120_000;
export const maxTerminalOutputBytes = 5 * 1024 * 1024;

export const runTerminalCommand: TerminalCommandRunner = async (request) => {
  const startedAt = Date.now();

  return new Promise<TerminalCommandResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const child = spawn(
      request.file,
      request.args,
      {
        cwd: request.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, request.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const accepted = collectChunk(stdoutChunks, chunk, stdoutBytes);
      stdoutBytes += accepted.byteLength;
      if (accepted.byteLength > 0) {
        request.onStdout?.(accepted.toString("utf8"));
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const accepted = collectChunk(stderrChunks, chunk, stderrBytes);
      stderrBytes += accepted.byteLength;
      if (accepted.byteLength > 0) {
        request.onStderr?.(accepted.toString("utf8"));
      }
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const stderr = Buffer.concat(stderrChunks).toString("utf8") || error.message;
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr,
        exitCode: typeof error.code === "number" ? error.code : 1,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const exitCode = timedOut ? 124 : code ?? (signal ? 1 : 0);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
};

function collectChunk(chunks: Buffer[], chunk: Buffer, currentBytes: number): Buffer {
  const remainingBytes = maxTerminalOutputBytes - currentBytes;
  if (remainingBytes <= 0) {
    return Buffer.alloc(0);
  }

  const accepted = chunk.byteLength > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;
  chunks.push(accepted);
  return accepted;
}
