import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DesktopSetup, writeJsonAtomic } from "./desktop-setup.js";
export type RestoreTask = { id: string; name: string; snapshotFile: string; snapshotSha256: string; status: "queued" | "uploading" | "paused" | "failed" | "completed" | "cleared"; updatedAt: string; uploads: Array<{ uploadId: string; assetId: string; bytes: number; filename: string }> };
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
function parseTasks(value: unknown): RestoreTask[] {
  if (!Array.isArray(value) || value.length > 500 || value.some(task => !task || !validId(task.id) || typeof task.name !== "string" || typeof task.snapshotFile !== "string" || typeof task.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(task.snapshotSha256) || !["queued", "uploading", "paused", "failed", "completed", "cleared"].includes(task.status) || typeof task.updatedAt !== "string" || !Array.isArray(task.uploads) || task.uploads.some((upload: RestoreTask["uploads"][number]) => !upload || !validId(upload.uploadId) || !validId(upload.assetId) || !Number.isSafeInteger(upload.bytes) || upload.bytes < 0 || typeof upload.filename !== "string"))) throw new Error("Invalid restore journal");
  return value as RestoreTask[];
}
export class RestoreJournal {
  constructor(private readonly setup: DesktopSetup) {}
  private async folder(account: string) {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(account)) throw new Error("本地账户标识无效。");
    const setup = await this.setup.status(); if (!setup.root || !setup.available) throw new Error("工作区不可用。");
    const path = join(setup.root, "Projects", account); await mkdir(path, { recursive: true });
    if (await realpath(path) !== path) throw new Error("本地记录目录不能是链接。");
    return path;
  }
  async list(account: string): Promise<RestoreTask[]> {
    const path = join(await this.folder(account), "restore-tasks.json");
    try {
      if ((await stat(path)).size > 4 * 1024 ** 2 || await realpath(path) !== path) throw new Error("Invalid journal");
      const tasks = parseTasks(JSON.parse(await readFile(path, "utf8")));
      return tasks.map(task => task.status === "uploading" ? { ...task, status: "paused" as const } : task);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("本地恢复任务记录无法读取，原文件仍保留。", { cause: error }); }
  }
  async save(account: string, task: RestoreTask) {
    const items = await this.list(account), next = parseTasks([task])[0]!;
    const tasks = [next, ...items.filter(item => item.id !== next.id)];
    // Bound completed history while keeping unfinished transfers visible.
    const keep = tasks.filter((item, index) => index < 100 || !["completed", "cleared"].includes(item.status));
    if (keep.length > 500) throw new Error("恢复任务记录已满，请先处理未完成的任务。");
    await writeJsonAtomic(join(await this.folder(account), "restore-tasks.json"), keep);
  }
  async queue(account: string, path: string, name: string, sha256: string): Promise<RestoreTask> {
    const folder = await this.folder(account), source = await realpath(path);
    const target = join(folder, basename(source));
    if (source !== target) throw new Error("请先将工程快照放入当前工作区的 Projects 账户目录。");
    const previous = (await this.list(account)).find(task => task.snapshotSha256 === sha256);
    const task: RestoreTask = previous ?? { id: randomUUID(), name, snapshotFile: basename(source), snapshotSha256: sha256, status: "queued", uploads: [], updatedAt: new Date().toISOString() };
    if (task.status === "cleared") { task.status = "queued"; task.uploads = []; }
    await this.save(account, task); return task;
  }
  async path(account: string, id: string) {
    const task = (await this.list(account)).find(item => item.id === id);
    if (!task || basename(task.snapshotFile) !== task.snapshotFile || /[\\/:]/.test(task.snapshotFile)) throw new Error("本地任务对应的快照不可用，请重新选择。");
    const path = join(await this.folder(account), task.snapshotFile);
    if (await realpath(path) !== path) throw new Error("快照不能是链接。");
    return { task, path };
  }
}
