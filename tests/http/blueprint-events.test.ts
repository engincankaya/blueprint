import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  handleBlueprintEventsRequest,
  type BlueprintChangeWatcher,
} from "../../src/server/routes/index.js";

function createRequest(): IncomingMessage & EventEmitter {
  return new EventEmitter() as IncomingMessage & EventEmitter;
}

function createResponseRecorder(): ServerResponse & {
  statusCodeWritten?: number;
  headersWritten?: Record<string, string>;
  body: string;
  ended: boolean;
} {
  const recorder = new EventEmitter() as ServerResponse & {
    statusCodeWritten?: number;
    headersWritten?: Record<string, string>;
    body: string;
    ended: boolean;
  };
  recorder.body = "";
  recorder.ended = false;
  recorder.writeHead = function writeHead(statusCode: number, headers?: Record<string, string>) {
    this.statusCodeWritten = statusCode;
    this.headersWritten = headers;
    return this;
  };
  recorder.write = function write(chunk: string) {
    this.body += chunk;
    return true;
  };
  recorder.end = function end(chunk?: string) {
    if (chunk) this.body += chunk;
    this.ended = true;
    return this;
  };
  return recorder;
}

function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  return body.trim().split(/\n\n/).filter(Boolean).map((block) => {
    const event = block.match(/^event: (.+)$/m)?.[1] ?? "message";
    const data = block.match(/^data: (.+)$/m)?.[1] ?? "{}";
    return { event, data: JSON.parse(data) as unknown };
  });
}

describe("blueprint events HTTP handler", () => {
  it("keeps an SSE connection open and emits blueprint change events", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "blueprint-events-"));
    let onChange: (() => void) | undefined;
    let closed = false;
    const watcher: BlueprintChangeWatcher = (_projectRoot, callback) => {
      onChange = callback;
      return {
        close: () => {
          closed = true;
        },
      };
    };
    const request = createRequest();
    const response = createResponseRecorder();

    handleBlueprintEventsRequest(projectRoot, request, response, watcher);

    expect(response.statusCodeWritten).toBe(200);
    expect(response.headersWritten).toMatchObject({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    expect(parseSseEvents(response.body)).toEqual([
      { event: "ready", data: { status: "connected" } },
    ]);
    expect(response.ended).toBe(false);

    onChange?.();

    expect(parseSseEvents(response.body)).toEqual([
      { event: "ready", data: { status: "connected" } },
      { event: "blueprint-changed", data: { status: "changed" } },
    ]);

    request.emit("close");

    expect(closed).toBe(true);
  });
});
