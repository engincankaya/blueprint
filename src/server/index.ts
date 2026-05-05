import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApiServerContext,
  type ApiServerOptions,
} from "./context.js";
import { createApiRouter, handleTerminalQueryStreamRequest } from "./routes/index.js";
import {
  HttpStatusCode,
  setCorsHeaders,
  tryServeStatic,
  writeJson,
} from "./utils.js";

export function createApiServer(options: ApiServerOptions): Server {
  const context = createApiServerContext(options);
  const router = createApiRouter(context.services, context.logger);

  return createServer(async (request, response) => {
    setCorsHeaders(response, context.corsOrigin);

    if (request.method === "OPTIONS") {
      response.writeHead(HttpStatusCode.NoContent);
      response.end();
      return;
    }

    try {
      const url = parseIncomingRequestUrl(request.url);
      if (request.method === "POST" && url.pathname === "/api/terminal/query/stream") {
        await handleTerminalQueryStreamRequest(
          context.projectRoot,
          request,
          response,
          context.services.terminalQuery,
          context.logger,
        );
        return;
      }

      const result = await router.dispatch(request, url, context.projectRoot);
      if (result) {
        writeJson(response, result.statusCode, result.payload);
        return;
      }

      if (request.method === "GET" && context.staticRoot) {
        const served = await tryServeStatic(url.pathname, context.staticRoot, response);
        if (served) {
          return;
        }
      }

      writeJson(response, HttpStatusCode.NotFound, { error: "not found" });
    } catch (err) {
      writeJson(response, HttpStatusCode.InternalServerError, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function parseIncomingRequestUrl(requestUrl: string | undefined): URL {
  return new URL(requestUrl ?? "/", "http://local.request");
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const projectRoot = resolveConfiguredProjectRoot();
  const staticRoot = resolveConfiguredStaticRoot();

  const server = createApiServer({
    projectRoot,
    staticRoot,
    logger: (message) => console.error(message),
  });

  server.listen(port, host, () => {
    console.error(`Terminal AI HTTP bridge listening on http://${host}:${port}`);
    console.error(`Terminal AI project root: ${projectRoot}`);
    if (staticRoot) {
      console.error(`Serving frontend static files from: ${staticRoot}`);
    }
  });
}

function resolveConfiguredProjectRoot(): string {
  return resolve(process.env.TERMINAL_AI_PROJECT_ROOT ?? process.cwd());
}

function resolveConfiguredStaticRoot(): string | undefined {
  if (process.env.TERMINAL_AI_STATIC_ROOT) {
    return resolve(process.env.TERMINAL_AI_STATIC_ROOT);
  }
  return resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
