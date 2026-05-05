/**
 * Shared refresh contracts for detecting and applying deterministic Blueprint file changes.
 */
import { type BlueprintOutput } from "../compose/compose.types.js";

export interface ScannedBlueprintFile {
  id: string;
  path: string;
  hash: string;
  category: string;
  language: string;
  sizeBytes?: number;
}

export interface BlueprintRefreshPlan {
  added: Array<{
    fileId: string;
    path: string;
    category: string;
    language: string;
    hash: string;
  }>;
  updated: Array<{
    fileId: string;
    path: string;
    groupId: string;
    previousHash: string;
    currentHash: string;
  }>;
  deleted: Array<{
    fileId: string;
    path: string;
    groupId: string;
    previousHash: string;
  }>;
  unchanged: Array<{
    fileId: string;
    path: string;
    groupId: string;
    hash: string;
  }>;
  ignored: ScannedBlueprintFile[];
  emptyGroupCandidates: Array<{
    groupId: string;
    name: string;
    docsPath: string;
    deletedFileIds: string[];
  }>;
}

export interface DeterministicBlueprintRefreshResult {
  output: BlueprintOutput;
  plan: BlueprintRefreshPlan;
  updatedFiles: BlueprintRefreshPlan["updated"];
  deletedFiles: BlueprintRefreshPlan["deleted"];
  addedFiles: BlueprintRefreshPlan["added"];
  unassignedFiles: Array<{
    fileId: string;
    path: string;
    category: string;
    language: string;
  }>;
  emptyGroupCandidates: BlueprintRefreshPlan["emptyGroupCandidates"];
  affectedGroups: string[];
}
