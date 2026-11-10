import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { backupAssetIds, projectBackupSchema, type ProjectBackup } from "@helstera/shared";
import { DesktopSetup, writeJsonAtomic } from "./desktop-setup.js";
import { fileSha256 } from "./local-download.js";
import { assertAccount, readWorkspaceIndex } from "./workspace-index.js";
import { resolveWorkspaceReceipt, workspaceReceiptPath } from "./workspace-receipt.js";
import { RestoreJournal } from "./restore-journal.js";

type Snapshot = { path: string; sha256: string; bytes: number; document: ProjectBackup };
type CleanupFile = { path: string; bytes: number; sha256: string };
type CleanupPlan = { id: string; projectId: string; name: string; snapshots: number; mediaFiles: number; sharedMedia: number; bytes: number; files: string[]; canceledTasks: number };
type PendingCleanup = { preview: CleanupPlan; root: string; account: string; fingerprint: string; files: CleanupFile[]; expires: number };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export class WorkspaceCleanup {
  private pending?: PendingCleanup;
  private running = false;
  constructor(private readonly setup: DesktopSetup) {}
  get busy() { return this.running; }
  private async scan(account: unknown) {
    assertAccount(account);
    const setup = await this.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用。");
    const root = setup.root, folder = join(root, "Projects", account);
    const index = await readWorkspaceIndex(root, account), journal = new RestoreJournal(this.setup);
    const tasks = await journal.list(account);
    if (await realpath(folder) !== folder) throw new Error("工程目录不能是链接。");
    const snapshots: Snapshot[] = []; let scanned = 0;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (["backup-index.json", "restore-tasks.json"].includes(entry.name) || !entry.name.endsWith(".json")) continue;
      const path = join(folder, entry.name), info = await stat(path);
      if (!entry.isFile() || await realpath(path) !== path || info.size > 16 * 1024 ** 2) throw new Error("有无法核对的快照，暂不能安全清理。请先检查工程目录。");
      scanned += info.size;
      if (snapshots.length >= 500 || scanned > 128 * 1024 ** 2) throw new Error("工程记录超过安全扫描上限，请分开整理工作区后再清理。");
      const bytes = await readFile(path);
      const parsed = projectBackupSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success || parsed.data.project.workspace?.ownerUserId && parsed.data.project.workspace.ownerUserId !== account) throw new Error(`快照 ${entry.name} 无法核对归属，请先检查文件。`);
      snapshots.push({ path, bytes: bytes.length, sha256: hash(bytes), document: parsed.data });
    }
    const fingerprint = hash(JSON.stringify({ root, index, tasks, snapshots: snapshots.map(s => [s.path, s.sha256]).sort() }));
    return { root, account, index, tasks, snapshots, fingerprint };
  }
  async projects(account: unknown) {
    const scan = await this.scan(account);
    const groups = new Map<string, { id: string; name: string; snapshots: number; snapshotBytes: number; mediaBytes: number; assets: Set<string> }>();
    for (const snapshot of scan.snapshots) {
      const project = snapshot.document.project;
      const group = groups.get(project.id) ?? { id: project.id, name: project.name, snapshots: 0, snapshotBytes: 0, mediaBytes: 0, assets: new Set<string>() };
      group.snapshots++; group.snapshotBytes += snapshot.bytes;
      for (const id of backupAssetIds(snapshot.document)) group.assets.add(id);
      groups.set(project.id, group);
    }
    for (const group of groups.values()) {
      const counted = new Set<string>();
      for (const id of group.assets) {
        const receipt = scan.index.items.find(item => item.key === `asset:${id}`)?.receipt;
        const path = workspaceReceiptPath(scan.root, "Media", scan.account, receipt);
        if (!path || counted.has(path)) continue;
        try { if (await realpath(path) === path) { group.mediaBytes += (await stat(path)).size; counted.add(path); } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
    return [...groups.values()].map(({ assets, ...group }) => group).sort((a, b) => b.mediaBytes + b.snapshotBytes - a.mediaBytes - a.snapshotBytes);
  }
  async prepare(account: unknown, projectId: unknown): Promise<CleanupPlan> {
    if (this.busy) throw new Error("清理正在进行。");
    const scan = await this.scan(account);
    const selected = scan.snapshots.filter(item => item.document.project.id === projectId);
    if (!selected.length) throw new Error("工程记录已改变，请刷新列表。");
    const names = new Set(selected.map(item => basename(item.path)));
    if (scan.tasks.some(task => names.has(task.snapshotFile) && !["completed", "cleared"].includes(task.status) && task.uploads.length > 0)) throw new Error("这个工程仍有待恢复或暂停的任务，请先完成恢复，或清理任务暂存后再整理文件。");
    const otherAssets = new Set(scan.snapshots.filter(item => item.document.project.id !== projectId).flatMap(item => backupAssetIds(item.document)));
    const protectedPaths = new Set([...otherAssets].map(id => workspaceReceiptPath(scan.root, "Media", scan.account, scan.index.items.find(item => item.key === `asset:${id}`)?.receipt)).filter(Boolean));
    const files: CleanupFile[] = selected.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    const selectedAssets = new Set(selected.flatMap(item => backupAssetIds(item.document)));
    let sharedMedia = 0;
    for (const id of selectedAssets) {
      const saved = scan.index.items.find(item => item.key === `asset:${id}`)?.receipt;
      const path = workspaceReceiptPath(scan.root, "Media", scan.account, saved);
      if (otherAssets.has(id) || path && protectedPaths.has(path)) { sharedMedia++; continue; }
      const receipt = await resolveWorkspaceReceipt(scan.root, "Media", scan.account, saved);
      if (path && !receipt) {
        try { await stat(path); throw new Error("本地素材与校验记录不一致，未加入清理。请先检查原文件。"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      if (receipt && !files.some(file => file.path === receipt.path)) files.push(receipt);
    }
    const preview: CleanupPlan = { id: randomUUID(), projectId: String(projectId), name: selected[0]!.document.project.name, snapshots: selected.length, mediaFiles: files.length - selected.length, sharedMedia, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files: files.map(file => basename(file.path)), canceledTasks: scan.tasks.filter(task => names.has(task.snapshotFile) && !["completed", "cleared"].includes(task.status)).length };
    this.pending = { preview, root: scan.root, account: scan.account, fingerprint: scan.fingerprint, files, expires: Date.now() + 5 * 60_000 };
    return preview;
  }
  async apply(id: unknown) {
    if (this.running) throw new Error("清理正在进行。");
    const plan = this.pending; this.pending = undefined;
    if (!plan || plan.preview.id !== id || plan.expires < Date.now()) throw new Error("清理预览已失效，请重新检查。");
    this.running = true;
    try {
      const scan = await this.scan(plan.account);
      if (scan.root !== plan.root || scan.fingerprint !== plan.fingerprint) throw new Error("工程或工作区已改变，请重新预览清理范围。");
      for (const file of plan.files) {
        if (await realpath(file.path) !== file.path || (await stat(file.path)).size !== file.bytes || await fileSha256(file.path) !== file.sha256) throw new Error("本地文件已改变，请重新预览；尚未清理任何文件。");
      }
      const removed = new Set<string>(); let removedBytes = 0; const errors: string[] = [];
      for (const file of plan.files) {
        try { await unlink(file.path); removed.add(file.path); removedBytes += file.bytes; }
        catch (error) { console.error("[workspace-cleanup] File removal failed", file.path, error); errors.push(`${basename(file.path)} 无法删除，可能仍被占用。`); }
      }
      scan.index.items = scan.index.items.filter(item => !removed.has(workspaceReceiptPath(plan.root, item.key.startsWith("asset:") ? "Media" : "Projects", plan.account, item.receipt) ?? ""));
      await writeJsonAtomic(join(plan.root, "Projects", plan.account, "backup-index.json"), scan.index);
      await writeJsonAtomic(join(plan.root, "Projects", plan.account, "restore-tasks.json"), scan.tasks.filter(task => !removed.has(join(plan.root, "Projects", plan.account, task.snapshotFile))));
      return { removedFiles: removed.size, removedBytes, errors };
    } finally { this.running = false; }
  }
}
