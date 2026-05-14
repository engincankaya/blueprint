import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  blueprintDir,
  blueprintOutputPath,
  briefPath,
  groupDocsDir,
} from "../lib/blueprint-paths.js";
import { renderBlueprintViewer } from "../viewer/render-html.js";

export interface BlueprintWatchOptions {
  projectRoot: string;
  debounceMs: number;
  render: (projectRoot: string) => Promise<{ htmlPath: string }>;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export interface BlueprintCliOptions {
  argv: string[];
  cwd: string;
  render?: (projectRoot: string) => Promise<{ htmlPath: string }>;
  open?: (htmlPath: string) => Promise<void>;
  watch?: (options: BlueprintWatchOptions) => Promise<void>;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export async function runBlueprintCli(options: BlueprintCliOptions): Promise<number> {
  const [command, ...args] = options.argv;
  if (command !== "open") {
    options.stderr?.write(usage());
    return command ? 1 : 0;
  }
  const parsed = parseOpenArgs(args);
  if (!parsed.ok) {
    options.stderr?.write(`${parsed.message}\n\n${usage()}`);
    return 1;
  }

  const render = options.render ?? ((projectRoot) => renderBlueprintViewer({ projectRoot }));
  const open = options.open ?? openInDefaultBrowser;
  const watchSources = options.watch ?? watchBlueprintViewerSources;
  const projectRoot = resolve(options.cwd);
  const result = await render(projectRoot);
  await open(result.htmlPath);
  if (parsed.watch) {
    await watchSources({
      projectRoot,
      debounceMs: parsed.debounceMs,
      render,
      stderr: options.stderr,
    });
  }
  return 0;
}

export async function openInDefaultBrowser(htmlPath: string): Promise<void> {
  const target = pathToFileURL(htmlPath).toString();
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", target]
    : [target];

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

function usage(): string {
  return [
    "Usage: blueprint open [--watch] [--debounce <ms>]",
    "",
    "Commands:",
    "  open    Render .blueprint/index.html and open it in the default browser",
    "",
    "Options:",
    "  --watch          Re-render .blueprint/index.html when Blueprint memory changes",
    "  --debounce <ms>  Debounce watch renders (default: 250)",
    "",
  ].join("\n");
}

type ParseOpenArgsResult =
  | { ok: true; watch: boolean; debounceMs: number }
  | { ok: false; message: string };

function parseOpenArgs(args: string[]): ParseOpenArgsResult {
  let shouldWatch = false;
  let debounceMs = 250;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--watch") {
      shouldWatch = true;
      continue;
    }
    if (arg === "--debounce") {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, message: "--debounce requires a millisecond value" };
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, message: "--debounce must be a non-negative integer" };
      }
      debounceMs = parsed;
      index += 1;
      continue;
    }
    return { ok: false, message: `Unknown option: ${arg}` };
  }
  return { ok: true, watch: shouldWatch, debounceMs };
}

export async function watchBlueprintViewerSources(options: BlueprintWatchOptions): Promise<void> {
  const root = blueprintDir(options.projectRoot);
  if (!existsSync(root)) {
    options.stderr?.write(`No Blueprint memory directory found at ${root}\n`);
    return;
  }

  let previousSnapshot = await collectBlueprintSourceSnapshot(options.projectRoot);
  let timer: NodeJS.Timeout | undefined;
  let rendering = false;
  let pending = false;
  let scanning = false;
  const intervalMs = Math.max(50, options.debounceMs);
  const interval = setInterval(() => {
    void scanForChanges();
  }, intervalMs);

  await new Promise<void>((resolvePromise) => {
    const finish = (): void => {
      clearInterval(interval);
      if (timer) {
        clearTimeout(timer);
      }
      process.off("SIGINT", closeOnSignal);
      process.off("SIGTERM", closeOnSignal);
      resolvePromise();
    };
    const closeOnSignal = (): void => {
      finish();
    };
    process.once("SIGINT", closeOnSignal);
    process.once("SIGTERM", closeOnSignal);
  });

  async function scanForChanges(): Promise<void> {
    if (scanning) {
      return;
    }
    scanning = true;
    try {
      const nextSnapshot = await collectBlueprintSourceSnapshot(options.projectRoot);
      if (!snapshotsEqual(previousSnapshot, nextSnapshot)) {
        previousSnapshot = nextSnapshot;
        scheduleRender();
      }
    } catch (error) {
      options.stderr?.write(`${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      scanning = false;
    }
  }

  function scheduleRender(): void {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void renderWhenReady();
    }, options.debounceMs);
  }

  async function renderWhenReady(): Promise<void> {
    if (rendering) {
      pending = true;
      return;
    }
    rendering = true;
    try {
      await options.render(options.projectRoot);
    } catch (error) {
      options.stderr?.write(`${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      rendering = false;
      if (pending) {
        pending = false;
        scheduleRender();
      }
    }
  }
}

async function collectBlueprintSourceSnapshot(projectRoot: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  await addFileToSnapshot(snapshot, blueprintOutputPath(projectRoot));
  await addFileToSnapshot(snapshot, briefPath(projectRoot));

  const docsRoot = groupDocsDir(projectRoot);
  try {
    const entries = await readdir(docsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        await addFileToSnapshot(snapshot, join(docsRoot, entry.name));
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  return snapshot;
}

async function addFileToSnapshot(snapshot: Map<string, string>, path: string): Promise<void> {
  try {
    const fileStat = await stat(path);
    snapshot.set(path, `${fileStat.mtimeMs}:${fileStat.size}`);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function snapshotsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code: unknown }).code === "ENOENT";
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).toString();
  }
}

if (isCliEntrypoint()) {
  runBlueprintCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stderr: process.stderr,
  }).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
