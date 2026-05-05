import { v4 as uuidv4 } from "uuid";

export type ArtifactType =
  | "fileInventory"
  | "analysisFacts"
  | "groupingResult"
  | "blueprintOutput";

export interface ArtifactEntry {
  id: string;
  type: ArtifactType;
  data: unknown;
  createdAt: string;
  summary: string;
}

/**
 * In-memory artifact store for server-side state.
 *
 * Large data objects (inventory, analysis facts, grouping results) are stored
 * here and referenced by artifactId. The LLM only receives compact summaries,
 * saving ~75-87% tokens.
 */
export class ArtifactStore {
  private store = new Map<string, ArtifactEntry>();

  put(
    type: ArtifactType,
    data: unknown,
    summary: string,
  ): string {
    const id = uuidv4();
    const entry: ArtifactEntry = {
      id,
      type,
      data,
      createdAt: new Date().toISOString(),
      summary,
    };
    this.store.set(id, entry);
    console.error(`[ArtifactStore] Stored ${type}: ${id}`);
    return id;
  }

  get(id: string): ArtifactEntry | undefined {
    return this.store.get(id);
  }

  getSummary(id: string): string | undefined {
    return this.store.get(id)?.summary;
  }

  getTyped<T>(id: string, expectedType: ArtifactType): T | undefined {
    const entry = this.store.get(id);
    if (!entry) {
      console.error(`[ArtifactStore] Not found: ${id}`);
      return undefined;
    }
    if (entry.type !== expectedType) {
      console.error(
        `[ArtifactStore] Type mismatch for ${id}: expected ${expectedType}, got ${entry.type}`,
      );
      return undefined;
    }
    return entry.data as T;
  }

  delete(id: string): boolean {
    const deleted = this.store.delete(id);
    if (deleted) {
      console.error(`[ArtifactStore] Deleted: ${id}`);
    }
    return deleted;
  }

  clear(): void {
    const count = this.store.size;
    this.store.clear();
    console.error(`[ArtifactStore] Cleared ${count} artifacts`);
  }

  listIds(): string[] {
    return Array.from(this.store.keys());
  }

  get size(): number {
    return this.store.size;
  }
}
