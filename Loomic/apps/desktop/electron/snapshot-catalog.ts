import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { backupAssetIds, projectBackupSchema } from "@helstera/shared";
import { DesktopSetup } from "./desktop-setup.js";
import { snapshotOverview, compareSnapshots } from "./snapshot-preview.js";
import { readWorkspaceIndex } from "./workspace-index.js";
import { resolveWorkspaceReceipt } from "./workspace-receipt.js";
export type LocalSnapshot = { id: string; projectId: string; name: string; fileName: string; savedAt: string; bytes: number; elements: number; sessions: number; messages: number; thumbnail: string };
export type SnapshotList = { snapshots: LocalSnapshot[]; unreadable: number; truncated: boolean };
const MAX_SNAPSHOT = 16 * 1024 ** 2;
type SnapshotFile = { path: string; sha256: string; accountId: string; root: string };
export class SnapshotCatalog {
  private files = new Map<string, SnapshotFile>();
  private entries: LocalSnapshot[] = [];
  constructor(private readonly setup: DesktopSetup) {}
  async accounts() {
    const setup = await this.setup.status();
    if (!setup.available || !setup.root) throw new Error("请选择可用的本地工作区。");
    const folder = join(setup.root, "Projects");
    if (await realpath(folder) !== folder) throw new Error("快照目录不能是链接。");
    return (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(entry.name)).map(entry => entry.name);
  }
  async list(accountId: unknown): Promise<SnapshotList> {
    if (typeof accountId !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(accountId)) throw new Error("请先登录后查看本地快照。");
    const setup = await this.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用，请重新选择目录。");
    this.files.clear();
    this.entries = [];
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
      if (["backup-index.json", "restore-tasks.json"].includes(entry.name) || !entry.name.endsWith(".json") || !entry.isFile()) continue;
      if (listing.snapshots.length >= 500 || scannedBytes >= 128 * 1024 ** 2) { listing.truncated = true; break; }
      try {
        const path = join(folder, entry.name), info = await stat(path);
        if (await realpath(path) !== path || info.size > MAX_SNAPSHOT || !info.size) throw new Error("Invalid snapshot file");
        const bytes = await readFile(path); scannedBytes += bytes.length;
        const snapshot = projectBackupSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (snapshot.project.workspace?.ownerUserId && snapshot.project.workspace.ownerUserId !== accountId) throw new Error("Snapshot account mismatch");
        const id = randomUUID(), recorded = saved.get(path) ?? [...saved].find(([oldPath]) => oldPath.replaceAll("\\", "/").split("/").slice(-3).join("/") === `Projects/${accountId}/${entry.name}`)?.[1];
        this.files.set(id, { path, sha256: createHash("sha256").update(bytes).digest("hex"), accountId, root: setup.root });
        listing.snapshots.push({ id, projectId: snapshot.project.id, name: snapshot.project.name, fileName: entry.name, savedAt: recorded && Number.isFinite(Date.parse(recorded)) ? recorded : info.mtime.toISOString(), bytes: bytes.length, elements: snapshot.canvas.content.elements.length, sessions: snapshot.sessions.length, messages: snapshot.sessions.reduce((sum, item) => sum + item.messages.length, 0), thumbnail: snapshotOverview(snapshot).thumbnail });
      } catch { listing.unreadable++; }
    }
    listing.snapshots.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    this.entries = listing.snapshots;
    return listing;
  }
  async overview(id: unknown, accountId: unknown, comparisonId?: unknown) {
    const path = await this.resolve(id, accountId), snapshot = projectBackupSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const entry = this.entries.find(item => item.id === id)!;
    const candidates = this.entries.filter(item => item.projectId === snapshot.project.id && item.id !== id);
    const baseline = typeof comparisonId === "string" ? candidates.find(item => item.id === comparisonId) : candidates.find(item => Date.parse(item.savedAt) <= Date.parse(entry.savedAt));
    if (comparisonId && !baseline) throw new Error("请选择同一工程的快照进行比较。");
    const previous = baseline ? projectBackupSchema.parse(JSON.parse(await readFile(await this.resolve(baseline.id, accountId), "utf8"))) : null;
    return { ...snapshotOverview(snapshot), media: backupAssetIds(snapshot).map((assetId, index) => ({ assetId, name: `本地素材 ${index + 1}` })), name: snapshot.project.name, projectId: snapshot.project.id, baseline: baseline ? { id: baseline.id, savedAt: baseline.savedAt, fileName: baseline.fileName } : null, difference: previous ? compareSnapshots(previous, snapshot) : null, versions: candidates.map(item => ({ id: item.id, savedAt: item.savedAt, fileName: item.fileName })) };
  }
  async media(id: unknown, accountId: unknown, assetId: unknown) {
    const snapshotPath = await this.resolve(id, accountId);
    const snapshot = projectBackupSchema.parse(JSON.parse(await readFile(snapshotPath, "utf8")));
    if (typeof assetId !== "string" || !backupAssetIds(snapshot).includes(assetId)) throw new Error("素材不属于当前快照。");
    const root = (await this.setup.status()).root!;
    const index = await readWorkspaceIndex(root, String(accountId));
    const receipt = await resolveWorkspaceReceipt(root, "Media", String(accountId), index.items.find(item => item.key === `asset:${assetId}`)?.receipt);
    if (!receipt) throw new Error("本地原文件缺失或校验失败。请连接原磁盘，或联网重新保存素材。");
    const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" } as Record<string, string>)[extname(receipt.path).toLowerCase()];
    if (!mime) throw new Error("此文件格式暂不能在离线预览中播放，请在工作区查看原文件。");
    return { root, path: receipt.path, mime, name: basename(receipt.path), bytes: receipt.bytes, sha256: receipt.sha256 };
  }
  async resolve(id: unknown, accountId: unknown): Promise<string> {
    const file = typeof id === "string" ? this.files.get(id) : undefined;
    if (!file || file.accountId !== accountId) throw new Error("快照列表已失效，请刷新后重试。");
    const setup = await this.setup.status();
    if (!setup.available || setup.root !== file.root || await realpath(file.path) !== file.path || (await stat(file.path)).size > MAX_SNAPSHOT || createHash("sha256").update(await readFile(file.path)).digest("hex") !== file.sha256) throw new Error("快照或工作区已改变，请刷新列表。");
    return file.path;
  }
}
