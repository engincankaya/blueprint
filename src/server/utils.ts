/**
 * Shared HTTP primitives for the API server.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, normalize, relative, resolve } from "node:path";

const maxJsonBodyBytes = 1024 * 1024;

export enum HttpStatusCode {
  Ok = 200,
  NoContent = 204,
  BadRequest = 400,
  Forbidden = 403,
  NotFound = 404,
  InternalServerError = 500,
}

export interface ApiRouteResult {
  statusCode: HttpStatusCode;
  payload: unknown;
}

export async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxJsonBodyBytes) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export async function tryServeStatic(
  pathname: string,
  staticRoot: string,
  response: ServerResponse,
): Promise<boolean> {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const relativePath = normalizedPath === "/" || normalizedPath === "."
    ? "index.html"
    : normalizedPath.replace(/^[/\\]/, "");
  const filePath = resolve(staticRoot, relativePath);

  if (!isPathInside(staticRoot, filePath)) {
    writeJson(response, HttpStatusCode.Forbidden, { error: "forbidden" });
    return true;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  response.writeHead(HttpStatusCode.Ok, {
    "content-type": contentTypeFor(filePath),
  });
  createReadStream(filePath).pipe(response);
  return true;
}

export function writeJson(
  response: ServerResponse,
  statusCode: HttpStatusCode,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

export function setCorsHeaders(response: ServerResponse, origin = "*"): void {
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
