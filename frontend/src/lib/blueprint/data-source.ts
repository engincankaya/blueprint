import type {
  BlueprintGroupDetailResponse,
  BlueprintGroupsOverviewResponse,
} from "@/lib/blueprint/api-types";

export interface BlueprintDataSource {
  getOverview(): Promise<BlueprintGroupsOverviewResponse>;
  getGroup(groupId: string): Promise<BlueprintGroupDetailResponse>;
  subscribe?: (onChange: () => void) => () => void;
}

export interface EmbeddedBlueprintData {
  overview: BlueprintGroupsOverviewResponse;
  details: Record<string, BlueprintGroupDetailResponse>;
}

interface EmbeddedDocument {
  getElementById(id: string): { textContent: string | null } | null;
}

export class EmbeddedBlueprintDataSource implements BlueprintDataSource {
  constructor(private readonly data: EmbeddedBlueprintData) {}

  static fromDocument(documentRef: EmbeddedDocument): EmbeddedBlueprintDataSource | undefined {
    const element = documentRef.getElementById("blueprint-data");
    const raw = element?.textContent?.trim();
    if (!raw) return undefined;
    return new EmbeddedBlueprintDataSource(JSON.parse(raw) as EmbeddedBlueprintData);
  }

  async getOverview(): Promise<BlueprintGroupsOverviewResponse> {
    return this.data.overview;
  }

  async getGroup(groupId: string): Promise<BlueprintGroupDetailResponse> {
    const detail = this.data.details[groupId];
    if (!detail) throw new Error(`Embedded group detail was not found (${groupId})`);
    return detail;
  }
}

export function createDefaultBlueprintDataSource(): BlueprintDataSource {
  const embedded = typeof document === "undefined"
    ? undefined
    : EmbeddedBlueprintDataSource.fromDocument(document);
  return embedded ?? new MissingBlueprintDataSource();
}

class MissingBlueprintDataSource implements BlueprintDataSource {
  async getOverview(): Promise<BlueprintGroupsOverviewResponse> {
    throw new Error("Embedded Blueprint data was not found. Run `blueprint open` from a project with .blueprint memory.");
  }

  async getGroup(groupId: string): Promise<BlueprintGroupDetailResponse> {
    throw new Error(`Embedded Blueprint data was not found (${groupId})`);
  }
}
