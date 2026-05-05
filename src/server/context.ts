import { resolve } from "node:path";
import {
  initServices,
  type ApiServices,
  type InitServicesOptions,
} from "../services/init-services.js";

export interface ApiServerOptions extends InitServicesOptions {
  projectRoot: string;
  staticRoot?: string;
  corsOrigin?: string;
}

export interface ApiServerContext {
  projectRoot: string;
  staticRoot?: string;
  corsOrigin?: string;
  logger?: (message: string) => void;
  services: ApiServices;
}

export function createApiServerContext(options: ApiServerOptions): ApiServerContext {
  const projectRoot = resolve(options.projectRoot);
  //test
  return {
    projectRoot,
    staticRoot: options.staticRoot ? resolve(options.staticRoot) : undefined,
    corsOrigin: options.corsOrigin,
    logger: options.logger,
    services: initServices(options),
  };
}
