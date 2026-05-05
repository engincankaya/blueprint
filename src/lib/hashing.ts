import { createHash } from "node:crypto";

/**
 * Generate a stable SHA-256 hash (hex, first 16 chars).
 * Used for file IDs and symbol IDs.
 */
export function sha256Short(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Generate a full SHA-256 hash (hex).
 * Used for content hashes.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Generate a stable file ID from a canonical path.
 */
export function fileId(canonicalPath: string): string {
  return sha256Short(canonicalPath);
}

/**
 * Generate a stable symbol ID from file ID + kind + name.
 */
export function symbolId(
  fileIdStr: string,
  kind: string,
  name: string,
): string {
  return sha256Short(`${fileIdStr}:${kind}:${name}`);
}
