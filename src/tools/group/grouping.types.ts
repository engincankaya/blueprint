import { type BlueprintFileCategory } from "../scan/scan-file-inventory-builder.js";

export interface GroupingPlan {
  project?: {
    summary?: string;
    purpose?: string;
    architecture?: string;
  };
  groups: Array<{
    id: string;
    name: string;
    description?: string;
    kind?: string;
    include: string[];
    exclude?: string[];
    confidence?: number;
  }>;
  fallback?: {
    strategy: "folder-category";
  };
}

export interface GroupedFile {
  fileId: string;
  path: string;
  category: BlueprintFileCategory;
  language: string;
  importance?: string;
  role?: string;
}

export interface GroupEdge {
  fromGroupId: string;
  toGroupId: string;
  type: string;
  count: number;
}

export interface BlueprintGroup {
  id: string;
  name: string;
  description?: string;
  kind?: string;
  confidence?: number;
  files: GroupedFile[];
}

export interface GroupValidation {
  isComplete: boolean;
  isAssignedCompletely: boolean;
  hasWarnings: boolean;
  blockingIssues: string[];
  warningIssues: string[];
  inventoryFiles: number;
  assignedFiles: number;
  unassignedFiles: ValidationFileRef[];
  duplicateAssignments: Array<ValidationFileRef & { groupIds: string[] }>;
  emptyGroups: string[];
  unknownPatterns: UnknownPattern[];
  fallbackAssignments: Array<ValidationFileRef & { fallbackGroupId: string }>;
}

export interface ValidationFileRef {
  fileId: string;
  path: string;
  category: BlueprintFileCategory;
  language: string;
}

export interface UnknownPattern {
  pattern: string;
  reason: string;
  suggestions: string[];
}

export interface GroupingResult {
  analysisArtifactId: string;
  inventoryArtifactId: string;
  project: {
    summary: string;
    purpose?: string;
    architecture?: string;
  };
  groups: BlueprintGroup[];
  crossGroupEdges: GroupEdge[];
  internalDependencyEdges: GroupEdge[];
  validation: GroupValidation;
}
