import {
  BlueprintGroupService,
  type BlueprintGroupDetailResult,
  type BlueprintGroupsResult,
} from "./blueprint-group-service.js";

type BlueprintGroupsPayload = Extract<BlueprintGroupsResult, { ok: true }>["payload"];
type BlueprintGroupDetailPayload = Extract<BlueprintGroupDetailResult, { ok: true }>["payload"];

export type BlueprintViewerDataResult =
  | {
    ok: true;
    payload: {
      overview: BlueprintGroupsPayload;
      details: Record<string, BlueprintGroupDetailPayload>;
    };
  }
  | {
    ok: false;
    reason: "blueprint-output-missing" | "group-detail-failed";
    message: string;
    groupId?: string;
  };

export class BlueprintViewerService extends BlueprintGroupService {
  async viewerData(projectRoot: string): Promise<BlueprintViewerDataResult> {
    const overview = await this.list(projectRoot);
    if (!overview.ok) return overview;

    const details: Record<string, BlueprintGroupDetailPayload> = {};
    for (const group of overview.payload.groups) {
      const detail = await this.detail(projectRoot, group.id);
      if (!detail.ok) {
        return {
          ok: false,
          reason: "group-detail-failed",
          message: detail.message,
          groupId: group.id,
        };
      }
      details[group.id] = detail.payload;
    }

    return {
      ok: true,
      payload: {
        overview: overview.payload,
        details,
      },
    };
  }
}
