import { BlueprintGroupService } from "./blueprint-group-service.js";

export interface ApiServices {
  blueprintGroup: BlueprintGroupService;
}

export interface InitServicesOptions {
  logger?: (message: string) => void;
}

export function initServices(options: InitServicesOptions): ApiServices {
  void options;
  return {
    blueprintGroup: new BlueprintGroupService(),
  };
}
