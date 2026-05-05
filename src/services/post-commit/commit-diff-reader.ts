import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type CommitFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface CommitFileChange {
  status: CommitFileStatus;
  path: string;
  oldPath?: string;
}

export interface CommitDiff {
  before: string;
  after: string;
  shortSha: string;
  subject: string;
  changedFiles: CommitFileChange[];
  rawDiff: string;
}

export interface CommitDiffCommandRequest {
  file: string;
  args: string[];
  cwd: string;
}

export type CommitDiffCommandRunner = (
  request: CommitDiffCommandRequest,
) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);

export const runCommitDiffCommand: CommitDiffCommandRunner = async (request) => {
  const { stdout } = await execFileAsync(request.file, request.args, {
    cwd: request.cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout };
};

export class CommitDiffReader {
  constructor(
    private readonly runner: CommitDiffCommandRunner = runCommitDiffCommand,
  ) {}

  async read(args: {
    projectRoot: string;
    before: string;
    after: string;
  }): Promise<CommitDiff> {
    const [gitPrefix, shortSha, subject, nameStatus, rawDiff] = await Promise.all([
      this.git(args.projectRoot, ["rev-parse", "--show-prefix"]),
      this.git(args.projectRoot, ["rev-parse", "--short", args.after]),
      this.git(args.projectRoot, ["log", "-1", "--pretty=%s", args.after]),
      this.git(args.projectRoot, ["diff", "--name-status", args.before, args.after]),
      this.git(args.projectRoot, [
        "diff",
        "--find-renames",
        "--unified=80",
        args.before,
        args.after,
      ]),
    ]);

    return {
      before: args.before,
      after: args.after,
      shortSha: shortSha.trim(),
      subject: subject.trim(),
      changedFiles: normalizeChanges(parseNameStatus(nameStatus), gitPrefix.trim()),
      rawDiff,
    };
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const result = await this.runner({ file: "git", args, cwd });
    return result.stdout;
  }
}

function normalizeChanges(changes: CommitFileChange[], gitPrefix: string): CommitFileChange[] {
  if (!gitPrefix) {
    return changes;
  }

  return changes.map((change) => ({
    ...change,
    path: stripGitPrefix(change.path, gitPrefix),
    ...(change.oldPath ? { oldPath: stripGitPrefix(change.oldPath, gitPrefix) } : {}),
  }));
}

function stripGitPrefix(path: string, gitPrefix: string): string {
  return path.startsWith(gitPrefix) ? path.slice(gitPrefix.length) : path;
}

export function parseNameStatus(stdout: string): CommitFileChange[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, firstPath, secondPath] = line.split(/\t+/);
      if (!rawStatus || !firstPath) {
        throw new Error(`Invalid git name-status line: ${line}`);
      }

      if (rawStatus.startsWith("R")) {
        if (!secondPath) {
          throw new Error(`Invalid git rename line: ${line}`);
        }
        return {
          status: "renamed",
          oldPath: firstPath,
          path: secondPath,
        };
      }

      return {
        status: normalizeStatus(rawStatus),
        path: firstPath,
      };
    });
}

function normalizeStatus(status: string): Exclude<CommitFileStatus, "renamed"> {
  switch (status) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    default:
      throw new Error(`Unsupported git file status: ${status}`);
  }
}
