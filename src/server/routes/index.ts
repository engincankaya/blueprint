import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiServices } from "../../services/init-services.js";
import {
  HttpStatusCode,
  readJsonBody,
  type ApiRouteResult,
} from "../utils.js";
import type { TerminalQueryRequest } from "../../services/terminal-query-service.js";
import { ApiRouter } from "./router.js";

const terminalQueryBodySchema = z.object({
  prompt: z.string().refine((value) => value.trim().length > 0, {
    message: "prompt is required",
  }),
  chatId: z.string({
    invalid_type_error: "chatId must be a string",
  }).optional(),
  provider: z.literal("codex", {
    invalid_type_error: "provider must be codex",
  }).optional(),
  mode: z.enum(["ask", "edit"], {
    invalid_type_error: "mode must be ask or edit",
  }).optional(),
  cwd: z.string({
    invalid_type_error: "cwd must be a string",
  }).optional(),
  timeoutMs: z.number({
    invalid_type_error: "timeoutMs must be a number",
  }).optional(),
  includeDebug: z.boolean({
    invalid_type_error: "includeDebug must be a boolean",
  }).optional(),
});

export type TerminalQueryHttpBody = z.input<typeof terminalQueryBodySchema>;

export function createApiRouter(
  services: ApiServices,
  logger?: (message: string) => void,
): ApiRouter {
  return new ApiRouter()
    .post("/api/terminal/query", async ({ request, projectRoot }) => (
      handleTerminalQueryBody(
        projectRoot,
        await readJsonBody<unknown>(request),
        services.terminalQuery,
        logger,
      )
    ))
    .get("/api/blueprint/groups", async ({ projectRoot }) => (
      handleBlueprintGroupsRequest(projectRoot, services.blueprintGroup)
    ))
    .get("/api/blueprint/groups/:groupId", async ({ projectRoot, params }) => (
      handleBlueprintGroupDetailRequest(projectRoot, params.groupId, services.blueprintGroup)
    ));
}

export async function handleTerminalQueryBody(
  projectRoot: string,
  body: unknown,
  service: ApiServices["terminalQuery"],
  logger?: (message: string) => void,
): Promise<ApiRouteResult> {
  const parsed = terminalQueryBodySchema.safeParse(body);
  if (!parsed.success) {
    const error = formatZodError(parsed.error, "invalid terminal query request");
    logger?.(`[terminal-http] rejected ${error}`);
    return {
      statusCode: HttpStatusCode.BadRequest,
      payload: { error },
    };
  }

  const terminalQueryRequest: TerminalQueryRequest = {
    projectRoot,
    ...parsed.data,
  };
  const result = await service.query(terminalQueryRequest, logger);

  return {
    statusCode: result.ok ? HttpStatusCode.Ok : HttpStatusCode.BadRequest,
    payload: result.payload,
  };
}

export async function handleTerminalQueryStreamRequest(
  projectRoot: string,
  request: IncomingMessage,
  response: ServerResponse,
  service: ApiServices["terminalQuery"],
  logger?: (message: string) => void,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  const parsed = terminalQueryBodySchema.safeParse(body);
  if (!parsed.success) {
    const error = formatZodError(parsed.error, "invalid terminal query request");
    logger?.(`[terminal-stream] rejected ${error}`);
    response.writeHead(HttpStatusCode.BadRequest, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error }));
    return;
  }

  response.writeHead(HttpStatusCode.Ok, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const terminalQueryRequest: TerminalQueryRequest = {
    projectRoot,
    ...parsed.data,
  };
  const result = await service.queryStream(
    terminalQueryRequest,
    {
      onEvent: (event) => writeSseEvent(response, event.type, event.data),
    },
    logger,
  );

  if (result.ok) {
    writeSseEvent(response, "done", result.payload);
  } else {
    writeSseEvent(response, "error", result.payload);
  }
  response.end();
}

export async function handleBlueprintGroupsRequest(
  projectRoot: string,
  service: ApiServices["blueprintGroup"],
): Promise<ApiRouteResult> {
  const result = await service.list(projectRoot);

  if (result.ok) {
    return { statusCode: HttpStatusCode.Ok, payload: result.payload };
  }

  return {
    statusCode: HttpStatusCode.NotFound,
    payload: { error: result.message },
  };
}

export async function handleBlueprintGroupDetailRequest(
  projectRoot: string,
  groupId: string,
  service: ApiServices["blueprintGroup"],
): Promise<ApiRouteResult> {
  const result = await service.detail(projectRoot, groupId);

  if (result.ok) {
    return { statusCode: HttpStatusCode.Ok, payload: result.payload };
  }

  if (result.reason === "forbidden") {
    return {
      statusCode: HttpStatusCode.Forbidden,
      payload: { error: result.message },
    };
  }

  return {
    statusCode: HttpStatusCode.NotFound,
    payload: {
      error: result.message,
      ...(result.groupId ? { groupId: result.groupId } : {}),
    },
  };
}

function writeSseEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function formatZodError(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
