import type { IncomingMessage } from "node:http";
import type { ApiRouteResult } from "../utils.js";

export interface ApiRouteContext {
  request: IncomingMessage;
  url: URL;
  projectRoot: string;
  params: Record<string, string>;
}

export interface ApiRoute {
  method: string;
  path: string;
  handle: (context: ApiRouteContext) => Promise<ApiRouteResult>;
}

export type ApiRouteHandler = (context: ApiRouteContext) => Promise<ApiRouteResult>;

export class ApiRouter {
  private readonly routes: ApiRoute[] = [];

  get(path: string, handle: ApiRouteHandler): this {
    return this.addRoute("GET", path, handle);
  }

  post(path: string, handle: ApiRouteHandler): this {
    return this.addRoute("POST", path, handle);
  }

  async dispatch(
    request: IncomingMessage,
    url: URL,
    projectRoot: string,
  ): Promise<ApiRouteResult | undefined> {
    for (const route of this.routes) {
      if (request.method !== route.method) continue;
      const params = this.matchPath(route.path, url.pathname);
      if (!params) continue;
      return route.handle({ request, url, projectRoot, params });
    }
    return undefined;
  }

  private addRoute(method: string, path: string, handle: ApiRouteHandler): this {
    this.routes.push({ method, path, handle });
    return this;
  }
  private matchPath(routePath: string, pathname: string): Record<string, string> | undefined {
    const routeParts = routePath.split("/").filter(Boolean);
    const pathParts = pathname.split("/").filter(Boolean);
    if (routeParts.length !== pathParts.length) {
      return undefined;
    }

    const params: Record<string, string> = {};
    for (let index = 0; index < routeParts.length; index += 1) {
      const routePart = routeParts[index];
      const pathPart = pathParts[index];
      if (routePart.startsWith(":")) {
        params[routePart.slice(1)] = decodeURIComponent(pathPart);
        continue;
      }
      if (routePart !== pathPart) {
        return undefined;
      }
    }
    return params;
  }
}


