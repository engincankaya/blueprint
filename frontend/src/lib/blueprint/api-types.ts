export interface BlueprintGroupConnection {
  groupId: string;
  groupName: string;
  direction: "incoming" | "outgoing";
  type: string;
  count: number;
}

export interface BlueprintGroupOverview {
  id: string;
  name: string;
  kind?: string;
  summary?: string;
  fileCount: number;
  docsStatus: "ready" | "missing" | "invalid";
  connections: BlueprintGroupConnection[];
}

export interface BlueprintGroupsOverviewResponse {
  schemaVersion: string;
  groups: BlueprintGroupOverview[];
  totals: {
    groups: number;
    files: number;
    edges: number;
  };
  validation: {
    isValid: boolean;
    warnings: string[];
  };
}

export interface BlueprintGroupDetailResponse {
  group: {
    id: string;
    name: string;
    kind?: string;
    summary?: string;
    docsPath?: string;
    fileCount: number;
  };
  doc: {
    exists: boolean;
    frontmatter: Record<string, string>;
    sections: Record<string, string | undefined>;
    validation: { warnings: string[] };
  };
  files: Array<{
    id: string;
    path: string;
    category: string;
    language?: string;
    summary?: string;
    role?: string;
  }>;
  connections: BlueprintGroupConnection[];
}
