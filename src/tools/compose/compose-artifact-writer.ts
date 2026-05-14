import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  blueprintOutputPath,
  briefPath,
} from "../../lib/blueprint-paths.js";
import { patchAgentsInstructions } from "../../lib/agent-instructions.js";
import { writeProjectBrief } from "../../lib/brief-builder.js";
import { renderGroupVisionNoteTemplate } from "../../lib/group-note-template.js";
import {
  type BlueprintOutput,
  type ComposeAssistantNextStep,
} from "./compose.types.js";

export class ComposeArtifactWriter {
  async write(rootPath: string, output: BlueprintOutput): Promise<void> {
    const writePath = blueprintOutputPath(rootPath);
    const json = `${JSON.stringify(output, null, 2)}\n`;
    await mkdir(dirname(writePath), { recursive: true });
    await writeFile(writePath, json, "utf-8");
    await writeProjectBrief(briefPath(rootPath), output);
    await this.writeGroupNotes(rootPath, output);
    await patchAgentsInstructions(rootPath);
  }

  async buildAssistantNextSteps(
    output: BlueprintOutput,
    rootPath?: string,
  ): Promise<ComposeAssistantNextStep[]> {
    const filePathsById = new Map(output.files.map((file) => [file.id, file.path] as const));
    const targets = await Promise.all(output.groups.map(async (group) => ({
      groupId: group.id,
      groupName: group.name,
      docsPath: group.docsPath,
      fileIds: group.fileIds,
      filePaths: group.fileIds
        .map((fileId) => filePathsById.get(fileId))
        .filter((path): path is string => Boolean(path))
        .sort(),
      status: await this.groupDocStatus(rootPath, group.docsPath),
    })));
    const required = targets.some((target) =>
      target.status === "missing" || target.status === "incomplete" || target.status === "unknown",
    );

    return [{
      kind: "hydrate-group-docs",
      required,
      executionPolicy: required ? "must_execute_before_final_response" : "optional",
      reason: required ? "group-docs-created-or-incomplete" : "group-docs-current",
      blockingReason: required
        ? "Group docs are templates or unavailable and must be hydrated before reporting Blueprint compose as complete."
        : undefined,
      message: required
        ? "Execute this step now before finalizing the user response. Spawn one sub-agent per target group doc and fill it from Blueprint facts plus source evidence. Do not ask the user unless the step is impossible."
        : "Group markdown files look hydrated. No group-doc hydration sub-agents are required.",
      parallelization: "one-sub-agent-per-group-doc",
      rules: [
        "Each sub-agent owns exactly one .blueprint/groups/*.md file.",
        "Each sub-agent may edit only its assigned group markdown file.",
        "Preserve the existing markdown headings.",
        "Read .blueprint/blueprint-output.json and the target group's related files as needed.",
        "Replace TODOs with concise, evidence-based project memory.",
        "Do not copy raw JSON dumps into markdown.",
        "Put uncertainty under Extension / Open Questions.",
      ],
      targets,
    }];
  }

  private async writeGroupNotes(rootPath: string, output: BlueprintOutput): Promise<void> {
    for (const group of output.groups) {
      const notePath = join(rootPath, group.docsPath);
      await this.writeFileIfMissing(
        notePath,
        renderGroupVisionNoteTemplate({
          group,
          factSnapshot: output.project.analysisArtifactId,
        }),
      );
    }
  }

  private async writeFileIfMissing(path: string, content: string): Promise<void> {
    try {
      await readFile(path, "utf-8");
      return;
    } catch {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
    }
  }

  private async groupDocStatus(
    rootPath: string | undefined,
    docsPath: string,
  ): Promise<ComposeAssistantNextStep["targets"][number]["status"]> {
    if (!rootPath) return "unknown";

    try {
      const content = await readFile(join(rootPath, docsPath), "utf-8");
      return /\bTODO\b/.test(content) ? "incomplete" : "current";
    } catch {
      return "missing";
    }
  }
}
