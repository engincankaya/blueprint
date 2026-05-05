#!/usr/bin/env node

/**
 * Copies only the needed Tree-sitter WASM grammars from tree-sitter-wasms
 * into dist/grammars/ for inclusion in the npm package.
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
];

const SRC_DIR = join(ROOT, "node_modules", "tree-sitter-wasms", "out");
const DEST_DIR = join(ROOT, "dist", "grammars");

mkdirSync(DEST_DIR, { recursive: true });

let copied = 0;
for (const lang of LANGUAGES) {
  const filename = `tree-sitter-${lang}.wasm`;
  const src = join(SRC_DIR, filename);
  const dest = join(DEST_DIR, filename);

  if (!existsSync(src)) {
    console.error(`WARNING: ${filename} not found in tree-sitter-wasms`);
    continue;
  }

  copyFileSync(src, dest);
  copied++;
  console.error(`  Copied ${filename}`);
}

console.error(`Done: ${copied}/${LANGUAGES.length} grammars copied to dist/grammars/`);
