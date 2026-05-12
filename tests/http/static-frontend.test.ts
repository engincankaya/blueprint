import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ServerResponse } from "node:http";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { resolveConfiguredStaticRoot } from "../../src/server/index.js";
import { tryServeStatic } from "../../src/server/utils.js";

function createResponseRecorder(): ServerResponse & {
  statusCodeWritten?: number;
  headersWritten?: Record<string, string>;
  body: string;
} {
  const recorder = new Writable({
    write(chunk, _encoding, callback) {
      recorder.body += chunk.toString();
      callback();
    },
  }) as ServerResponse & {
    statusCodeWritten?: number;
    headersWritten?: Record<string, string>;
    body: string;
  };
  recorder.body = "";
  recorder.writeHead = function writeHead(statusCode: number, headers?: Record<string, string>) {
    this.statusCodeWritten = statusCode;
    this.headersWritten = headers;
    return this;
  };
  return recorder;
}

function waitForFinish(response: ServerResponse): Promise<void> {
  return new Promise((resolvePromise) => {
    response.on("finish", () => resolvePromise());
  });
}

describe("static frontend server configuration", () => {
  it("serves the built Vite frontend from dist/frontend by default", () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/server");
    const expected = resolve(sourceRoot, "../../dist/frontend");

    expect(resolveConfiguredStaticRoot()).toBe(expected);
  });

  it("serves index.html from the static frontend root", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "blueprint-static-"));
    await mkdir(join(staticRoot, "assets"), { recursive: true });
    await writeFile(join(staticRoot, "index.html"), "<div id=\"root\"></div>", "utf-8");
    const response = createResponseRecorder();

    const finished = waitForFinish(response);
    const served = await tryServeStatic("/", staticRoot, response);
    await finished;

    expect(served).toBe(true);
    expect(response.statusCodeWritten).toBe(200);
    expect(response.headersWritten).toMatchObject({
      "content-type": "text/html; charset=utf-8",
    });
    expect(response.body).toContain("<div id=\"root\"></div>");
  });
});
