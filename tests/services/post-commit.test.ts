import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderGroupVisionNoteTemplate } from "../../src/lib/group-note-template.js";
import {
  type CommitDiffCommandRunner,
  CommitDiffReader,
} from "../../src/services/post-commit/commit-diff-reader.js";
import { ReviewFileNamer } from "../../src/services/post-commit/review-file-namer.js";
import {
  buildPostCommitPrompt,
  type PostCommitPromptInput,
} from "../../src/services/post-commit/post-commit-prompt-builder.js";
import { buildChangedFileContexts } from "../../src/services/post-commit/changed-file-context-builder.js";
import {
  ReviewMarkdownWriter,
  type BlueprintReviewMarkdown,
} from "../../src/services/post-commit/review-markdown-writer.js";
import { parseLlmReviewResponse } from "../../src/services/post-commit/llm-review-response-parser.js";
import { verifyPostCommitChanges } from "../../src/services/post-commit/post-commit-verifier.js";
import {
  BlueprintPostCommitService,
  type BlueprintPostCommitLlmRunner,
} from "../../src/services/post-commit/blueprint-post-commit-service.js";
import { parseBlueprintPostCommitCliArgs } from "../../src/cli/blueprint-post-commit.js";
import { PostCommitRefreshAdapter } from "../../src/services/post-commit/post-commit-refresh.js";
import { TerminalPostCommitLlmRunner } from "../../src/services/post-commit/terminal-llm-runner.js";
import { jsonResult } from "../../src/types.js";
import { type BlueprintOutput } from "../../src/tools/compose/compose.types.js";

describe("post-commit blueprint maintainer primitives", () => {
  it("reads commit metadata, name-status changes, and raw diff from git", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const runner: CommitDiffCommandRunner = async (request) => {
      calls.push(request);
      const command = request.args.join(" ");
      if (command === "rev-parse --show-prefix") return { stdout: "" };
      if (command === "rev-parse --short abc123") return { stdout: "abc1234\n" };
      if (command === "log -1 --pretty=%s abc123") return { stdout: "Add session store\n" };
      if (command === "diff --name-status def456 abc123") {
        return {
          stdout: [
            "A\tsrc/server/session-store.ts",
            "M\tsrc/services/terminal-query-service.ts",
            "D\tsrc/services/old-refresh.ts",
            "R100\tsrc/old.ts\tsrc/new.ts",
            "",
          ].join("\n"),
        };
      }
      if (command === "diff --find-renames --unified=80 def456 abc123") {
        return { stdout: "diff --git a/src/old.ts b/src/new.ts\n" };
      }
      throw new Error(`unexpected command: ${command}`);
    };

    const result = await new CommitDiffReader(runner).read({
      projectRoot: "/repo",
      before: "def456",
      after: "abc123",
    });

    expect(result).toEqual({
      before: "def456",
      after: "abc123",
      shortSha: "abc1234",
      subject: "Add session store",
      rawDiff: "diff --git a/src/old.ts b/src/new.ts\n",
      changedFiles: [
        { status: "added", path: "src/server/session-store.ts" },
        { status: "modified", path: "src/services/terminal-query-service.ts" },
        { status: "deleted", path: "src/services/old-refresh.ts" },
        { status: "renamed", path: "src/new.ts", oldPath: "src/old.ts" },
      ],
    });
    expect(calls.map((call) => call.file)).toEqual(["git", "git", "git", "git", "git"]);
  });

  it("normalizes git-root-relative paths to the project root", async () => {
    const runner: CommitDiffCommandRunner = async (request) => {
      const command = request.args.join(" ");
      if (command === "rev-parse --show-prefix") return { stdout: "mcp-server/\n" };
      if (command === "rev-parse --short HEAD") return { stdout: "abc1234\n" };
      if (command === "log -1 --pretty=%s HEAD") return { stdout: "Add post commit flow\n" };
      if (command === "diff --name-status HEAD~1 HEAD") {
        return {
          stdout: [
            "A\tmcp-server/src/cli/blueprint-post-commit.ts",
            "M\tmcp-server/package.json",
            "R100\tmcp-server/src/old.ts\tmcp-server/src/new.ts",
          ].join("\n"),
        };
      }
      if (command === "diff --find-renames --unified=80 HEAD~1 HEAD") {
        return {
          stdout: "diff --git a/mcp-server/src/old.ts b/mcp-server/src/new.ts\n",
        };
      }
      throw new Error(`unexpected command: ${command}`);
    };

    const result = await new CommitDiffReader(runner).read({
      projectRoot: "/repo/mcp-server",
      before: "HEAD~1",
      after: "HEAD",
    });

    expect(result.changedFiles).toEqual([
      { status: "added", path: "src/cli/blueprint-post-commit.ts" },
      { status: "modified", path: "package.json" },
      { status: "renamed", oldPath: "src/old.ts", path: "src/new.ts" },
    ]);
  });

  it("maps changed files to previous/current groups and affected group docs", () => {
    const previous = createBlueprintOutput();
    const current = createBlueprintOutput();
    current.files = current.files
      .filter((file) => file.path !== "src/services/old-refresh.ts")
      .concat({
        id: "file_session_store",
        path: "src/server/session-store.ts",
        groupId: "__unassigned__",
        category: "source",
        language: "typescript",
        notesStatus: "not-required",
      });
    current.groups = current.groups.map((group) =>
      group.id === "services"
        ? {
          ...group,
          fileIds: group.fileIds.filter((fileId) => fileId !== "file_old_refresh"),
        }
        : group);

    const result = buildChangedFileContexts({
      previous,
      current,
      changes: [
        { status: "added", path: "src/server/session-store.ts" },
        { status: "modified", path: "src/services/terminal-query-service.ts" },
        { status: "deleted", path: "src/services/old-refresh.ts" },
        { status: "renamed", oldPath: "src/server/old-context.ts", path: "src/server/context.ts" },
      ],
    });

    expect(result.changedFiles).toEqual([
      {
        status: "added",
        path: "src/server/session-store.ts",
        currentGroup: "__unassigned__",
      },
      {
        status: "modified",
        path: "src/services/terminal-query-service.ts",
        previousGroup: "services",
        currentGroup: "services",
        groupDocPath: "blueprint/groups/services.md",
      },
      {
        status: "deleted",
        path: "src/services/old-refresh.ts",
        previousGroup: "services",
        groupDocPath: "blueprint/groups/services.md",
      },
      {
        status: "renamed",
        oldPath: "src/server/old-context.ts",
        path: "src/server/context.ts",
        previousGroup: "http-server",
        currentGroup: "http-server",
        groupDocPath: "blueprint/groups/http-server.md",
      },
    ]);
    expect(result.unassignedFiles).toEqual([
      {
        fileId: "file_session_store",
        path: "src/server/session-store.ts",
        reason: "newly added file",
      },
    ]);
    expect(result.affectedGroupDocs).toEqual([
      "blueprint/groups/http-server.md",
      "blueprint/groups/services.md",
    ]);
  });

  it("builds stable review file names from commit subjects", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-file-namer-"));
    await mkdir(join(root, "blueprint", "reviews"), { recursive: true });
    await writeFile(join(root, "blueprint", "reviews", "add-session-store.md"), "", "utf-8");

    const namer = new ReviewFileNamer();

    expect(await namer.pathFor({
      projectRoot: root,
      subject: "Add session store",
      shortSha: "abc1234",
    })).toBe(join(root, "blueprint", "reviews", "add-session-store-abc1234.md"));
    expect(await namer.pathFor({
      projectRoot: root,
      subject: "!!!",
      shortSha: "def5678",
    })).toBe(join(root, "blueprint", "reviews", "commit-def5678.md"));
  });

  it("builds the restricted LLM prompt with structured context and raw diff", () => {
    const input: PostCommitPromptInput = {
      commit: "abc123",
      range: "def456..abc123",
      changedFiles: [
        {
          status: "modified",
          path: "src/services/terminal-query-service.ts",
          previousGroup: "services",
          currentGroup: "services",
          groupDocPath: "blueprint/groups/services.md",
        },
        {
          status: "added",
          path: "src/server/session-store.ts",
          currentGroup: "__unassigned__",
        },
      ],
      unassignedFiles: [
        {
          fileId: "file_session_store",
          path: "src/server/session-store.ts",
          reason: "newly added file",
        },
      ],
      affectedGroupDocs: ["blueprint/groups/services.md"],
      affectedGroupDocContents: [
        {
          path: "blueprint/groups/services.md",
          content: "# Services\n\n## Snapshot\n\nExisting service notes.",
        },
      ],
      projectLanguage: "Turkish",
      rawDiff: "diff --git a/src/services/terminal-query-service.ts b/src/services/terminal-query-service.ts\n",
    };

    const prompt = buildPostCommitPrompt(input);

    expect(prompt).toContain("# Blueprint Post-Commit Update");
    expect(prompt).toContain("Commit: abc123");
    expect(prompt).toContain("| modified | src/services/terminal-query-service.ts | services | services | blueprint/groups/services.md |");
    expect(prompt).toContain("| added | src/server/session-store.ts | - | __unassigned__ | - |");
    expect(prompt).toContain("| file_session_store | src/server/session-store.ts | newly added file |");
    expect(prompt).toContain("- blueprint/groups/services.md");
    expect(prompt).toContain("## Affected Group Doc Contents");
    expect(prompt).toContain("### blueprint/groups/services.md");
    expect(prompt).toContain("# Services\n\n## Snapshot\n\nExisting service notes.");
    expect(prompt).toContain("- Use `blueprint.group.update` for grouping changes.");
    expect(prompt).toContain("- The affected group docs are already included in this prompt; use those contents before deciding.");
    expect(prompt).toContain("You must write JSON content and Markdown group docs in Turkish.");
    expect(prompt).toContain("Keep group markdown structure exactly as generated by compose.");
    expect(prompt).toContain("Do not translate frontmatter keys, the H1 title, HTML comments, or these section headings:");
    expect(prompt).toContain("Snapshot, Responsibilities, Core Flow, Contracts & Invariants, Key Files, Change Guide, Pitfalls, Tests, Debugging, Extension / Open Questions");
    expect(prompt).toContain("- Do not run shell commands.");
    expect(prompt).toContain("- Do not edit `blueprint/blueprint-output.json` manually.");
    expect(prompt).toContain("Final response format:");
    expect(prompt).toContain("```diff\ndiff --git a/src/services/terminal-query-service.ts");
  });

  it("writes review markdown with frontmatter and human-readable sections", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-writer-"));
    const writer = new ReviewMarkdownWriter();
    const review: BlueprintReviewMarkdown = {
      commit: "abc123",
      range: "def456..abc123",
      status: "needs-human-review",
      createdAt: "2026-05-04T12:00:00.000Z",
      groupUpdate: "called",
      changedFiles: [
        {
          status: "modified",
          path: "src/services/terminal-query-service.ts",
          previousGroup: "services",
          currentGroup: "services",
          groupDocPath: "blueprint/groups/services.md",
        },
      ],
      docsUpdated: ["blueprint/groups/services.md"],
      docsReviewedNoChange: ["blueprint/groups/http-server.md"],
      needsHumanReview: ["blueprint/groups/runtime.md"],
      notes: ["No source files were modified by the blueprint maintainer."],
      summary: ["Assigned one new file."],
    };

    const path = join(root, "blueprint", "reviews", "add-session-store.md");
    await writer.write(path, review);

    const written = await readFile(path, "utf-8");
    expect(written).toContain("type: blueprint-review");
    expect(written).toContain("commit: abc123");
    expect(written).toContain("status: needs-human-review");
    expect(written).toContain("- blueprint/groups/services.md");
    expect(written).toContain("# Blueprint Review abc123");
    expect(written).toContain("## Changed Files");
    expect(written).toContain("| modified | src/services/terminal-query-service.ts | services | services | blueprint/groups/services.md |");
    expect(written).toContain("## Needs Human Review");
    expect(written).toContain("No source files were modified by the blueprint maintainer.");
  });

  it("parses the LLM final review response into stable fields", () => {
    const parsed = parseLlmReviewResponse([
      "- groupUpdate: called",
      "- docsUpdated: [blueprint/groups/services.md]",
      "- docsReviewedNoChange: [blueprint/groups/http-server.md]",
      "- needsHumanReview: [blueprint/groups/runtime.md]",
      "- notes: [Assigned session store, Runtime ownership unclear]",
    ].join("\n"));

    expect(parsed).toEqual({
      groupUpdate: "called",
      docsUpdated: ["blueprint/groups/services.md"],
      docsReviewedNoChange: ["blueprint/groups/http-server.md"],
      needsHumanReview: ["blueprint/groups/runtime.md"],
      notes: ["Assigned session store", "Runtime ownership unclear"],
    });
  });

  it("ignores incomplete bracket-only list values in LLM review responses", () => {
    const parsed = parseLlmReviewResponse([
      "- groupUpdate: called",
      "- docsUpdated: []",
      "- docsReviewedNoChange: []",
      "- needsHumanReview: [",
      "- notes: [",
    ].join("\n"));

    expect(parsed.needsHumanReview).toEqual([]);
    expect(parsed.notes).toEqual([]);
  });

  it("marks malformed LLM review responses as needing human review", () => {
    const parsed = parseLlmReviewResponse("Done");

    expect(parsed.groupUpdate).toBe("not-needed");
    expect(parsed.needsHumanReview).toEqual(["blueprint/reviews/latest"]);
    expect(parsed.notes[0]).toContain("Could not parse");
  });

  it("verifies post-commit changed files against allowed source, blueprint, and review paths", () => {
    const ok = verifyPostCommitChanges({
      changedPaths: [
        "blueprint/blueprint-output.json",
        "blueprint/groups/services.md",
        "blueprint/reviews/add-session-store.md",
      ],
      allowedGroupDocs: ["blueprint/groups/services.md"],
      reviewPath: "blueprint/reviews/add-session-store.md",
      hasUnassignedFiles: false,
      commands: [],
    });

    expect(ok).toEqual({
      isValid: true,
      status: "clean",
      errors: [],
      warnings: [],
    });

    const invalid = verifyPostCommitChanges({
      changedPaths: [
        "src/services/terminal-query-service.ts",
        "blueprint/groups/runtime.md",
      ],
      allowedGroupDocs: ["blueprint/groups/services.md"],
      reviewPath: "blueprint/reviews/add-session-store.md",
      hasUnassignedFiles: true,
      commands: ["git diff HEAD~1 HEAD"],
    });

    expect(invalid).toEqual({
      isValid: false,
      status: "failed",
      errors: [
        "Shell command used during blueprint maintainer run: git diff HEAD~1 HEAD",
        "Source file changed during blueprint maintainer run: src/services/terminal-query-service.ts",
        "Unexpected group doc changed: blueprint/groups/runtime.md",
        "Review markdown was not written: blueprint/reviews/add-session-store.md",
      ],
      warnings: [
        "Unassigned files remain after blueprint maintainer run.",
      ],
    });
  });

  it("runs the post-commit service in no-LLM mode, refreshes blueprint JSON, and writes a review artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "post-commit-service-"));
    await mkdir(join(root, "blueprint"), { recursive: true });
    await mkdir(join(root, "src", "services"), { recursive: true });
    await mkdir(join(root, "src", "server"), { recursive: true });
    await writeFile(
      join(root, "src", "services", "terminal-query-service.ts"),
      "export const terminalQuery = 1;\n",
      "utf-8",
    );
    await writeFile(
      join(root, "src", "server", "session-store.ts"),
      "export const sessionStore = 1;\n",
      "utf-8",
    );
    await writeFile(
      join(root, "blueprint", "blueprint-output.json"),
      JSON.stringify(createBlueprintOutput(), null, 2),
      "utf-8",
    );
    await writeFile(
      join(root, "blueprint", "refresh-scan.json"),
      JSON.stringify([
        {
          id: "file_terminal_query",
          path: "src/services/terminal-query-service.ts",
          hash: "old-hash",
          category: "source",
          language: "typescript",
        },
        {
          id: "file_old_refresh",
          path: "src/services/old-refresh.ts",
          hash: "old-refresh-hash",
          category: "source",
          language: "typescript",
        },
      ], null, 2),
      "utf-8",
    );
    const diffReader = {
      read: async () => ({
        before: "def456",
        after: "abc123",
        shortSha: "abc1234",
        subject: "Add session store",
        changedFiles: [
          { status: "modified" as const, path: "src/services/terminal-query-service.ts" },
          { status: "added" as const, path: "src/server/session-store.ts" },
          { status: "deleted" as const, path: "src/services/old-refresh.ts" },
        ],
        rawDiff: "diff --git a/src/services/terminal-query-service.ts b/src/services/terminal-query-service.ts\n",
      }),
    };
    const llmRunner: BlueprintPostCommitLlmRunner = async () => {
      throw new Error("LLM should not run");
    };

    const result = await new BlueprintPostCommitService({
      diffReader,
      llmRunner,
    }).handle({
      projectRoot: root,
      before: "def456",
      after: "abc123",
      runLlm: false,
      createdAt: "2026-05-04T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.reviewPath).toBe(join(root, "blueprint", "reviews", "add-session-store.md"));
    expect(result.llm.ran).toBe(false);
    expect(result.prompt).toContain("## Changed Areas");
    expect(result.prompt).toContain("| added | src/server/session-store.ts | - | __unassigned__ | - |");
    const review = await readFile(result.reviewPath, "utf-8");
    expect(review).toContain("status: needs-human-review");
    expect(review).toContain("groupUpdate: not-needed");
    expect(review).toContain("| modified | src/services/terminal-query-service.ts | services | services | blueprint/groups/services.md |");
    const output = JSON.parse(
      await readFile(join(root, "blueprint", "blueprint-output.json"), "utf-8"),
    ) as BlueprintOutput;
    expect(output.files.find((file) => file.path === "src/server/session-store.ts")).toMatchObject({
      groupId: "__unassigned__",
    });
    expect(output.files.some((file) => file.path === "src/services/old-refresh.ts")).toBe(false);
    const refreshScan = JSON.parse(
      await readFile(join(root, "blueprint", "refresh-scan.json"), "utf-8"),
    ) as Array<{ path: string }>;
    expect(refreshScan.map((file) => file.path)).toContain("src/server/session-store.ts");
  });

  it("marks the review as failed when the LLM reports shell commands or source edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "blueprint-post-commit-llm-violation-"));
    await mkdir(join(root, "src", "services"), { recursive: true });
    await mkdir(join(root, "blueprint"), { recursive: true });
    await writeFile(join(root, "src", "services", "terminal-query-service.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(
      join(root, "blueprint", "blueprint-output.json"),
      JSON.stringify(createBlueprintOutput(), null, 2),
      "utf-8",
    );
    const diffReader = {
      read: async () => ({
        before: "def456",
        after: "abc123",
        shortSha: "abc1234",
        subject: "Update terminal query",
        changedFiles: [
          { status: "modified" as const, path: "src/services/terminal-query-service.ts" },
        ],
        rawDiff: "diff --git a/src/services/terminal-query-service.ts b/src/services/terminal-query-service.ts\n",
      }),
    };
    const llmRunner: BlueprintPostCommitLlmRunner = async () => ({
      response: [
        "- groupUpdate: not-needed",
        "- docsUpdated: []",
        "- docsReviewedNoChange: [blueprint/groups/services.md]",
        "- needsHumanReview: []",
        "- notes: []",
      ].join("\n"),
      runDetails: {
        commands: [{ command: "git status --short" }],
        files: [{ path: "src/services/terminal-query-service.ts", action: "edit" }],
      },
    });

    const result = await new BlueprintPostCommitService({
      diffReader,
      llmRunner,
    }).handle({
      projectRoot: root,
      before: "def456",
      after: "abc123",
      runLlm: true,
      createdAt: "2026-05-04T12:00:00.000Z",
    });

    const review = await readFile(result.reviewPath, "utf-8");
    expect(review).toContain("status: failed");
    expect(review).toContain("Shell command used during blueprint maintainer run: git status --short");
    expect(review).toContain("Source file changed during blueprint maintainer run: src/services/terminal-query-service.ts");
  });

  it("marks the review as failed when a new group doc does not preserve the compose template", async () => {
    const root = await mkdtemp(join(tmpdir(), "blueprint-post-commit-bad-group-doc-"));
    await mkdir(join(root, "src", "services"), { recursive: true });
    await mkdir(join(root, "blueprint", "groups"), { recursive: true });
    await writeFile(join(root, "src", "services", "post-commit.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(
      join(root, "blueprint", "blueprint-output.json"),
      JSON.stringify(createBlueprintOutput(), null, 2),
      "utf-8",
    );
    const diffReader = {
      read: async () => ({
        before: "def456",
        after: "abc123",
        shortSha: "abc1234",
        subject: "Add post commit maintenance",
        changedFiles: [
          { status: "added" as const, path: "src/services/post-commit.ts" },
        ],
        rawDiff: "diff --git a/src/services/post-commit.ts b/src/services/post-commit.ts\n",
      }),
    };
    const llmRunner: BlueprintPostCommitLlmRunner = async () => {
      const output = createBlueprintOutput();
      output.groups.push({
        id: "post-commit-blueprint-maintenance",
        name: "Post-Commit Blueprint Maintenance",
        summary: "Owns post-commit blueprint maintenance.",
        docsPath: "blueprint/groups/post-commit-blueprint-maintenance.md",
        fileIds: [],
      });
      await writeFile(
        join(root, "blueprint", "blueprint-output.json"),
        JSON.stringify(output, null, 2),
        "utf-8",
      );
      await writeFile(
        join(root, "blueprint", "groups", "post-commit-blueprint-maintenance.md"),
        "# Post-Commit Blueprint Maintenance\n\nCustom notes without canonical sections.\n",
        "utf-8",
      );
      return {
        response: [
          "- groupUpdate: called",
          "- docsUpdated: [blueprint/groups/post-commit-blueprint-maintenance.md]",
          "- docsReviewedNoChange: []",
          "- needsHumanReview: []",
          "- notes: []",
        ].join("\n"),
      };
    };

    const result = await new BlueprintPostCommitService({
      diffReader,
      llmRunner,
    }).handle({
      projectRoot: root,
      before: "def456",
      after: "abc123",
      runLlm: true,
      createdAt: "2026-05-04T12:00:00.000Z",
    });

    const review = await readFile(result.reviewPath, "utf-8");
    expect(review).toContain("status: failed");
    expect(review).toContain("Group doc is not canonical: blueprint/groups/post-commit-blueprint-maintenance.md");
    expect(review).toContain("frontmatter.type must be group-note");
    expect(review).toContain("expected 10 canonical sections");
  });

  it("rebuilds review context after LLM grouping and fails when created docs are still templates", async () => {
    const root = await mkdtemp(join(tmpdir(), "blueprint-post-commit-rebuild-context-"));
    await mkdir(join(root, "src", "services"), { recursive: true });
    await mkdir(join(root, "blueprint", "groups"), { recursive: true });
    await writeFile(join(root, "src", "services", "post-commit.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(
      join(root, "blueprint", "blueprint-output.json"),
      JSON.stringify(createBlueprintOutput(), null, 2),
      "utf-8",
    );
    const diffReader = {
      read: async () => ({
        before: "def456",
        after: "abc123",
        shortSha: "abc1234",
        subject: "Add post commit maintenance",
        changedFiles: [
          { status: "added" as const, path: "src/services/post-commit.ts" },
        ],
        rawDiff: "diff --git a/src/services/post-commit.ts b/src/services/post-commit.ts\n",
      }),
    };
    const llmRunner: BlueprintPostCommitLlmRunner = async () => {
      const output = JSON.parse(
        await readFile(join(root, "blueprint", "blueprint-output.json"), "utf-8"),
      ) as BlueprintOutput;
      const newFile = output.files.find((file) => file.path === "src/services/post-commit.ts");
      if (!newFile) throw new Error("new file missing");
      newFile.groupId = "post-commit-blueprint-maintainer";
      output.groups.push({
        id: "post-commit-blueprint-maintainer",
        name: "Post-Commit Blueprint Maintainer",
        summary: "Owns post-commit blueprint maintenance.",
        docsPath: "blueprint/groups/post-commit-blueprint-maintainer.md",
        fileIds: [newFile.id],
      });
      await writeFile(
        join(root, "blueprint", "blueprint-output.json"),
        JSON.stringify(output, null, 2),
        "utf-8",
      );
      await writeFile(
        join(root, "blueprint", "groups", "post-commit-blueprint-maintainer.md"),
        renderGroupVisionNoteTemplate({
          group: {
            id: "post-commit-blueprint-maintainer",
            name: "Post-Commit Blueprint Maintainer",
          },
          factSnapshot: "refresh",
        }),
        "utf-8",
      );
      return {
        response: [
          "- groupUpdate: called",
          "- docsUpdated: [blueprint/groups/post-commit-blueprint-maintainer.md]",
          "- docsReviewedNoChange: []",
          "- needsHumanReview: []",
          "- notes: []",
        ].join("\n"),
      };
    };

    const result = await new BlueprintPostCommitService({
      diffReader,
      llmRunner,
    }).handle({
      projectRoot: root,
      before: "def456",
      after: "abc123",
      runLlm: true,
      createdAt: "2026-05-04T12:00:00.000Z",
    });

    const review = await readFile(result.reviewPath, "utf-8");
    expect(review).toContain("status: failed");
    expect(review).toContain("| added | src/services/post-commit.ts | - | post-commit-blueprint-maintainer | blueprint/groups/post-commit-blueprint-maintainer.md |");
    expect(review).not.toContain("Unassigned files remain after blueprint maintainer run.");
    expect(review).toContain("Group doc is still a template: blueprint/groups/post-commit-blueprint-maintainer.md");
  });

  it("parses post-commit CLI arguments with safe defaults", () => {
    expect(parseBlueprintPostCommitCliArgs([
      "--project-root",
      "/repo",
      "--before",
      "def456",
      "--after",
      "abc123",
      "--timeout-ms",
      "1234",
      "--print-prompt",
      "--no-llm",
    ])).toEqual({
      projectRoot: "/repo",
      before: "def456",
      after: "abc123",
      runLlm: false,
      timeoutMs: 1234,
      printPrompt: true,
    });

    const defaults = parseBlueprintPostCommitCliArgs([]);
    expect(defaults.before).toBe("HEAD~1");
    expect(defaults.after).toBe("HEAD");
    expect(defaults.runLlm).toBe(true);
    expect(defaults.printPrompt).toBe(false);
  });

  it("adapts post-commit changed paths to deterministic refresh results", () => {
    const previous = createBlueprintOutput();
    const previousScan = [
      {
        id: "file_terminal_query",
        path: "src/services/terminal-query-service.ts",
        hash: "old-hash",
        category: "source",
        language: "typescript",
      },
      {
        id: "file_old_refresh",
        path: "src/services/old-refresh.ts",
        hash: "old-refresh-hash",
        category: "source",
        language: "typescript",
      },
      {
        id: "file_context",
        path: "src/server/context.ts",
        hash: "context-hash",
        category: "source",
        language: "typescript",
      },
      {
        id: "file_old_context",
        path: "src/server/old-context.ts",
        hash: "old-context-hash",
        category: "source",
        language: "typescript",
      },
    ];
    const currentScan = [
      {
        id: "file_terminal_query_new_scan",
        path: "src/services/terminal-query-service.ts",
        hash: "new-hash",
        category: "source",
        language: "typescript",
      },
      {
        id: "file_session_store",
        path: "src/server/session-store.ts",
        hash: "session-hash",
        category: "source",
        language: "typescript",
      },
      {
        id: "file_context",
        path: "src/server/context.ts",
        hash: "context-hash",
        category: "source",
        language: "typescript",
      },
      {
        id: "file_old_context",
        path: "src/server/old-context.ts",
        hash: "old-context-hash",
        category: "source",
        language: "typescript",
      },
    ];

    const result = new PostCommitRefreshAdapter().refresh({
      previous,
      previousScan,
      currentScan,
      changedPaths: [
        "src/services/terminal-query-service.ts",
        "src/services/old-refresh.ts",
        "src/server/session-store.ts",
      ],
    });

    expect(result.updatedFiles).toEqual([
      {
        fileId: "file_terminal_query",
        path: "src/services/terminal-query-service.ts",
        groupId: "services",
        previousHash: "old-hash",
        currentHash: "new-hash",
      },
    ]);
    expect(result.deletedFiles.map((file) => file.path)).toEqual(["src/services/old-refresh.ts"]);
    expect(result.unassignedFiles).toEqual([
      {
        fileId: "file_session_store",
        path: "src/server/session-store.ts",
        category: "source",
        language: "typescript",
      },
    ]);
  });

  it("runs post-commit LLM prompts through TerminalQueryService and returns the answer", async () => {
    const calls: unknown[] = [];
    const terminalQueryService = {
      handle: async (args: unknown) => {
        calls.push(args);
        return jsonResult({
          answer: [
            "- groupUpdate: not-needed",
            "- docsUpdated: []",
            "- docsReviewedNoChange: [blueprint/groups/services.md]",
            "- needsHumanReview: []",
            "- notes: [No docs needed]",
          ].join("\n"),
        });
      },
    };

    const answer = await new TerminalPostCommitLlmRunner(
      terminalQueryService as never,
      1234,
    ).run("Prompt", {
      projectRoot: "/repo",
      allowedGroupDocs: ["blueprint/groups/services.md"],
    });

    expect(calls).toEqual([
      {
        prompt: "Prompt",
        projectRoot: "/repo",
        mode: "edit",
        timeoutMs: 1234,
      },
    ]);
    expect(answer.response).toContain("groupUpdate: not-needed");
  });
});

function createBlueprintOutput(): BlueprintOutput {
  return {
    schemaVersion: "blueprint.v1",
    project: {
      analysisArtifactId: "analysis_1",
      inventoryArtifactId: "inventory_1",
    },
    groups: [
      {
        id: "services",
        name: "Services",
        kind: "service",
        docsPath: "blueprint/groups/services.md",
        fileIds: ["file_terminal_query", "file_old_refresh"],
      },
      {
        id: "http-server",
        name: "HTTP Server",
        kind: "api",
        docsPath: "blueprint/groups/http-server.md",
        fileIds: ["file_context"],
      },
    ],
    files: [
      {
        id: "file_terminal_query",
        path: "src/services/terminal-query-service.ts",
        groupId: "services",
        category: "source",
        language: "typescript",
        notesStatus: "missing",
      },
      {
        id: "file_old_refresh",
        path: "src/services/old-refresh.ts",
        groupId: "services",
        category: "source",
        language: "typescript",
        notesStatus: "missing",
      },
      {
        id: "file_context",
        path: "src/server/context.ts",
        groupId: "http-server",
        category: "source",
        language: "typescript",
        notesStatus: "missing",
      },
      {
        id: "file_old_context",
        path: "src/server/old-context.ts",
        groupId: "http-server",
        category: "source",
        language: "typescript",
        notesStatus: "missing",
      },
    ],
    symbols: [],
    edges: [],
    fileEdges: [],
    entrypoints: [],
    testLinks: [],
    validation: {
      isValid: true,
      issues: [],
      warnings: [],
      groupingIssueSummary: [],
      groupingWarningSummary: [],
      documentationValid: true,
    },
  };
}
