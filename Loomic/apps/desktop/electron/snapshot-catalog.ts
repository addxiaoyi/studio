import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { projectBackupSchema } from "@helstera/shared";
import { DesktopSetup } from "./desktop-setup.js";
export type LocalSnapshot = { id: string; projectId: string; name: string; fileName: string; savedAt: string; bytes: number; elements: number; sessions: number; messages: number };
export type SnapshotList = { snapshots: LocalSnapshot[]; unreadable: number; truncated: boolean };
const MAX_SNAPSHOT = 16 * 1024 ** 2;
type SnapshotFile = { path: string; sha256: string; accountId: string; root: string };
export class SnapshotCatalog {
  private files = new Map<string, SnapshotFile>();
  constructor(private readonly setup: DesktopSetup) {}
  async list(accountId: unknown): Promise<SnapshotList> {
    if (typeof accountId !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(accountId)) throw new Error("请先登录后查看本地快照。");
    const setup = await this.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用，请重新选择目录。");
    this.files.clear();
    const folder = join(setup.root, "Projects", accountId);
    const listing: SnapshotList = { snapshots: [], unreadable: 0, truncated: false };
    try { if (await realpath(folder) !== folder) throw new Error("快照目录不能是链接。"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return listing; throw error; }
    let saved = new Map<string, string>();
    try {
      const index = JSON.parse(await readFile(join(folder, "backup-index.json"), "utf8"));
      if (index.account === accountId && Array.isArray(index.items)) saved = new Map(index.items.filter((item: { receipt?: { path?: string; savedAt?: string } }) => item.receipt?.path && item.receipt.savedAt).map((item: { receipt: { path: string; savedAt: string } }) => [item.receipt.path, item.receipt.savedAt]));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") listing.unreadable++; }
    const entries = await readdir(folder, { withFileTypes: true });
    let scannedBytes = 0;
    for (const entry of entries) {
      if (entry.name === "backup-index.json" || !entry.name.endsWith(".json") || !entry.isFile()) continue;
      if (listing.snapshots.length >= 500 || scannedBytes >= 128 * 1024 ** 2) { listing.truncated = true; break; }
      try {
        const path = join(folder, entry.name), info = await stat(path);
        if (await realpath(path) !== path || info.size > MAX_SNAPSHOT || !info.size) throw new Error("Invalid snapshot file");
        const bytes = await readFile(path); scannedBytes += bytes.length;
        const snapshot = projectBackupSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (snapshot.project.workspace?.ownerUserId && snapshot.project.workspace.ownerUserId !== accountId) throw new Error("Snapshot account mismatch");
        const id = randomUUID(), recorded = saved.get(path);
        this.files.set(id, { path, sha256: createHash("sha256").update(bytes).digest("hex"), accountId, root: setup.root });
        listing.snapshots.push({ id, projectId: snapshot.project.id, name: snapshot.project.name, fileName: entry.name, savedAt: recorded && Number.isFinite(Date.parse(recorded)) ? recorded : info.mtime.toISOString(), bytes: bytes.length, elements: snapshot.canvas.content.elements.length, sessions: snapshot.sessions.length, messages: snapshot.sessions.reduce((sum, item) => sum + item.messages.length, 0) });
      } catch { listing.unreadable++; }
    }
    listing.snapshots.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    return listing;
  }
  async resolve(id: unknown, accountId: unknown): Promise<string> {
    const file = typeof id === "string" ? this.files.get(id) : undefined;
    if (!file || file.accountId !== accountId) throw new Error("快照列表已失效，请刷新后重试。");
    const setup = await this.setup.status();
    if (!setup.available || setup.root !== file.root || await realpath(file.path) !== file.path || (await stat(file.path)).size > MAX_SNAPSHOT || createHash("sha256").update(await readFile(file.path)).digest("hex") !== file.sha256) throw new Error("快照或工作区已改变，请刷新列表。");
    return file.path;
  }
}
