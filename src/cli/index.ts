import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderBlueprintViewer } from "../viewer/render-html.js";

export interface BlueprintCliOptions {
  argv: string[];
  cwd: string;
  render?: (projectRoot: string) => Promise<{ htmlPath: string }>;
  open?: (htmlPath: string) => Promise<void>;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export async function runBlueprintCli(options: BlueprintCliOptions): Promise<number> {
  const [command] = options.argv;
  if (command !== "open") {
    options.stderr?.write(usage());
    return command ? 1 : 0;
  }

  const render = options.render ?? ((projectRoot) => renderBlueprintViewer({ projectRoot }));
  const open = options.open ?? openInDefaultBrowser;
  const projectRoot = resolve(options.cwd);
  const result = await render(projectRoot);
  await open(result.htmlPath);
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
    "Usage: blueprint open",
    "",
    "Commands:",
    "  open    Render .blueprint/index.html and open it in the default browser",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).toString()) {
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
