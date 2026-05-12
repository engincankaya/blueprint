import { existsSync, watch, type FSWatcher } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { ApiServices } from "../../services/init-services.js";
import {
  HttpStatusCode,
  type ApiRouteResult,
} from "../utils.js";
import { ApiRouter } from "./router.js";

export type BlueprintChangeWatcher = (
  projectRoot: string,
  onChange: () => void,
) => { close: () => void };

export function createApiRouter(
  services: ApiServices,
  logger?: (message: string) => void,
): ApiRouter {
  void logger;
  return new ApiRouter()
    .get("/api/blueprint/groups", async ({ projectRoot }) => (
      handleBlueprintGroupsRequest(projectRoot, services.blueprintGroup)
    ))
    .get("/api/blueprint/groups/:groupId", async ({ projectRoot, params }) => (
      handleBlueprintGroupDetailRequest(projectRoot, params.groupId, services.blueprintGroup)
    ));
}

export function handleBlueprintEventsRequest(
  projectRoot: string,
  request: IncomingMessage,
  response: ServerResponse,
  watcher: BlueprintChangeWatcher = watchBlueprintFiles,
): void {
  response.writeHead(HttpStatusCode.Ok, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  writeSseEvent(response, "ready", { status: "connected" });

  const subscription = watcher(projectRoot, () => {
    writeSseEvent(response, "blueprint-changed", { status: "changed" });
  });
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    subscription.close();
  };

  request.on("close", cleanup);
  response.on("close", cleanup);
}

export const watchBlueprintFiles: BlueprintChangeWatcher = (projectRoot, onChange) => {
  const watchers: FSWatcher[] = [];
  const outputPath = join(projectRoot, "blueprint", "blueprint-output.json");
  const groupsPath = join(projectRoot, "blueprint", "groups");

  if (existsSync(outputPath)) {
    watchers.push(watch(outputPath, onChange));
  }
  if (existsSync(groupsPath)) {
    watchers.push(watch(groupsPath, onChange));
  }

  return {
    close: () => {
      for (const fileWatcher of watchers) {
        fileWatcher.close();
      }
    },
  };
};

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
