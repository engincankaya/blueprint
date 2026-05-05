import { type BlueprintOutput } from "../../tools/compose/compose.types.js";
import { type CommitFileChange } from "./commit-diff-reader.js";
import { type PostCommitChangedFileContext } from "./post-commit-prompt-builder.js";

export interface ChangedFileContextResult {
  changedFiles: PostCommitChangedFileContext[];
  unassignedFiles: Array<{
    fileId: string;
    path: string;
    reason: string;
  }>;
  affectedGroupDocs: string[];
}

export function buildChangedFileContexts(args: {
  previous: BlueprintOutput;
  current: BlueprintOutput;
  changes: CommitFileChange[];
}): ChangedFileContextResult {
  const previousFilesByPath = new Map(args.previous.files.map((file) => [file.path, file]));
  const currentFilesByPath = new Map(args.current.files.map((file) => [file.path, file]));
  const previousGroupsById = new Map(args.previous.groups.map((group) => [group.id, group]));
  const currentGroupsById = new Map(args.current.groups.map((group) => [group.id, group]));

  const changedFiles = args.changes.map((change): PostCommitChangedFileContext => {
    const previousPath = change.oldPath ?? change.path;
    const previousFile = previousFilesByPath.get(previousPath);
    const currentFile = currentFilesByPath.get(change.path);
    const previousGroup = previousFile ? previousGroupsById.get(previousFile.groupId) : undefined;
    const currentGroup = currentFile ? currentGroupsById.get(currentFile.groupId) : undefined;
    const groupDocPath = currentGroup?.docsPath ?? previousGroup?.docsPath;

    return {
      status: change.status,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      path: change.path,
      ...(previousFile ? { previousGroup: previousFile.groupId } : {}),
      ...(currentFile ? { currentGroup: currentFile.groupId } : {}),
      ...(groupDocPath && groupDocPath !== "__unassigned__" ? { groupDocPath } : {}),
    };
  });

  const unassignedFiles = args.current.files
    .filter((file) => file.groupId === "__unassigned__")
    .filter((file) => args.changes.some((change) => change.path === file.path))
    .map((file) => ({
      fileId: file.id,
      path: file.path,
      reason: "newly added file",
    }));

  const affectedGroupDocs = Array.from(new Set(
    changedFiles
      .map((file) => file.groupDocPath)
      .filter((path): path is string => Boolean(path)),
  )).sort();

  return {
    changedFiles,
    unassignedFiles,
    affectedGroupDocs,
  };
}
