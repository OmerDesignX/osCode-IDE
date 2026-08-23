import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AiHistoryEntry = {
  id: string;
  createdAt: string;
  path: string;
  before: string | null;
  after: string;
  summary: string;
};

function projectKey(root: string) {
  return crypto.createHash("sha256").update(root.toLowerCase()).digest("hex");
}

export class AiHistoryStore {
  constructor(private readonly userData: string) {}

  private directory(root: string) {
    return path.join(this.userData, "ai", "history", projectKey(root));
  }

  private journal(root: string) {
    return path.join(this.directory(root), "journal.json");
  }

  async list(root: string): Promise<AiHistoryEntry[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.journal(root), "utf8"));
      return Array.isArray(value)
        ? value.filter(
            (item): item is AiHistoryEntry =>
              item &&
              typeof item.id === "string" &&
              typeof item.path === "string" &&
              typeof item.after === "string",
          )
        : [];
    } catch {
      return [];
    }
  }

  async record(
    root: string,
    relative: string,
    before: string | null,
    after: string,
  ) {
    if (before === after) return null;
    const entries = await this.list(root);
    const entry: AiHistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      path: relative,
      before,
      after,
      summary: before === null ? `Created ${relative}` : `Edited ${relative}`,
    };
    entries.push(entry);
    const directory = this.directory(root);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      this.journal(root),
      JSON.stringify(entries.slice(-250), null, 2),
      "utf8",
    );
    return entry;
  }

  async revert(root: string, id: string) {
    const entries = await this.list(root);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("That AI checkpoint is no longer available");
    const affected = new Set<string>();
    for (const entry of entries.slice(index).reverse()) {
      const target = path.resolve(root, entry.path);
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Checkpoint path is outside the project");
      if (entry.before === null) await fs.rm(target, { force: true });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.before, "utf8");
      }
      affected.add(entry.path);
    }
    await fs.writeFile(
      this.journal(root),
      JSON.stringify(entries.slice(0, index), null, 2),
      "utf8",
    );
    return [...affected];
  }
}
