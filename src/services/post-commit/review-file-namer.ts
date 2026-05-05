import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class ReviewFileNamer {
  async pathFor(args: {
    projectRoot: string;
    subject: string;
    shortSha: string;
  }): Promise<string> {
    const reviewsDir = join(args.projectRoot, "blueprint", "reviews");
    await mkdir(reviewsDir, { recursive: true });

    const baseName = slugifySubject(args.subject) || `commit-${args.shortSha}`;
    const preferredPath = join(reviewsDir, `${baseName}.md`);
    if (!await exists(preferredPath)) {
      return preferredPath;
    }

    return join(reviewsDir, `${baseName}-${args.shortSha}.md`);
  }
}

function slugifySubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
