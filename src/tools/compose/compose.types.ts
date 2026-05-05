export interface ComposeArgs {
  groupingArtifactId: string;
  language?: string;
}

export interface BlueprintOutputValidation {
  isValid: boolean;
  groupingComplete: boolean;
  groupingIssueSummary: string[];
  groupingWarningSummary: string[];
}

export interface ComposeResponseValidation {
  isValid: boolean;
  groupingComplete: boolean;
  groupingIssueSummary: string[];
  groupingWarningSummary: string[];
}

export interface ComposeAssistantNextStep {
  kind: "hydrate-group-docs";
  required: boolean;
  executionPolicy: "must_execute_before_final_response" | "optional";
  reason: "group-docs-created-or-incomplete" | "group-docs-current";
  blockingReason?: string;
  message: string;
  parallelization: "one-sub-agent-per-group-doc";
  rules: string[];
  targets: Array<{
    groupId: string;
    groupName: string;
    docsPath: string;
    fileIds: string[];
    filePaths: string[];
    status: "missing" | "incomplete" | "current" | "unknown";
  }>;
}

export interface BlueprintOutput {
  schemaVersion: "blueprint.v1";
  project: {
    analysisArtifactId: string;
    inventoryArtifactId: string;
    language: string;
    summary?: string;
    purpose?: string;
    architecture?: string;
  };
  groups: Array<{
    id: string;
    name: string;
    kind?: string;
    summary?: string;
    docsPath: string;
    fileIds: string[];
  }>;
  files: Array<{
    id: string;
    path: string;
    groupId: string;
    category: string;
    language: string;
    docsPath?: string;
    notesStatus: "missing" | "not-required";
    role?: string;
  }>;
  edges: Array<{
    fromGroupId: string;
    toGroupId: string;
    type: string;
    count: number;
  }>;
  fileEdges: Array<{
    fromFileId: string;
    toFileId: string;
    fromPath: string;
    toPath: string;
    type: string;
    symbols: string[];
  }>;
  symbols: Array<{
    id: string;
    fileId: string;
    path: string;
    name: string;
    kind: string;
    signature?: string;
    startLine?: number;
    endLine?: number;
    exported: boolean;
  }>;
  entrypoints: Array<{
    kind: "mcp-tool";
    name: string;
    handler: string;
    path: string;
    registrationPath: string;
  }>;
  testLinks: Array<{
    sourceFileId: string;
    sourcePath: string;
    testFileId: string;
    testPath: string;
    confidence: number;
    reasons: string[];
  }>;
  validation: BlueprintOutputValidation;
}
