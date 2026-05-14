#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePaths = [
  join(__dirname, "..", "dist", "index.js"),
  join(__dirname, "..", "dist", "cli", "index.js"),
];

for (const filePath of filePaths) {
  const content = readFileSync(filePath, "utf-8");
  if (!content.startsWith("#!")) {
    writeFileSync(filePath, "#!/usr/bin/env node\n" + content);
    console.error(`Added shebang to ${filePath}`);
  }
}
