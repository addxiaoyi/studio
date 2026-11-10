import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, statfs, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertAccount } from "./workspace-index.js";
import { writeJsonAtomic } from "./desktop-setup.js";

type Source = { root: string; account: string; path: string; mime: string; sha256: string };
type Limits = { maxBytes: number; maxFiles: number; reserveBytes: number };
const DEFAULTS: Limits = { maxBytes: 128 * 1024 ** 2, maxFiles: 1000, reserveBytes: 512 * 1024 ** 2 };
const MAX_THUMBNAIL = 256 * 1024;
const MAX_AGE = 30 * 24 * 60 * 60_000;
const ENTRY = /^[a-f\d-]{36}-[a-f0-9]{64}\.jpg$/;
type Cleanup = { at: string; files: number; bytes: number; reason: "automatic" | "settings" | "manual" };
type Settings = { capacityMiB?: number; lastCleanup?: Cleanup };

export class ThumbnailCache {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(private readonly render: (source: Source) => Promise<Buffer>, private readonly limits: Limits = DEFAULTS) {}
  get busy() { return this.queued > 0; }
  private serial<T>(action: () => Promise<T>) {
    if (this.queued >= 40) return Promise.reject(new Error("缩略图正在生成，请稍后重试。"));
    this.queued++;
    const job = this.tail.then(action).finally(() => { this.queued--; });
    this.tail = job.catch(() => undefined);
    return job;
  }
  private async folder(root: string) {
    const folder = join(root, "Cache", "Thumbnails"); await mkdir(folder, { recursive: true });
    if (await realpath(folder) !== folder) throw new Error("缩略图缓存目录不能是链接。");
    return folder;
  }
  private async entries(folder: string) {
    const files = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !ENTRY.test(entry.name)) continue;
      const path = join(folder, entry.name), info = await stat(path);
      if (await realpath(path) !== path) continue;
      files.push({ path, name: entry.name, bytes: info.size, touched: info.mtimeMs });
    }
    return files.sort((a, b) => a.touched - b.touched);
  }
  private async settings(root: string): Promise<Settings> {
    const path = join(root, "Cache", "thumbnail-settings.json");
    try {
      if (await realpath(path) !== path || (await stat(path)).size > 8192) throw new Error("Invalid cache settings");
      const saved = JSON.parse(await readFile(path, "utf8")) as Settings;
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid cache settings");
      if (saved.capacityMiB !== undefined && (!Number.isInteger(saved.capacityMiB) || saved.capacityMiB !== 0 && (saved.capacityMiB < 16 || saved.capacityMiB > 1024))) throw new Error("Invalid capacity");
      if (saved.lastCleanup && (typeof saved.lastCleanup.at !== "string" || !Number.isFinite(Date.parse(saved.lastCleanup.at)) || !Number.isSafeInteger(saved.lastCleanup.files) || saved.lastCleanup.files < 0 || !Number.isSafeInteger(saved.lastCleanup.bytes) || saved.lastCleanup.bytes < 0 || !["automatic", "manual", "settings"].includes(saved.lastCleanup.reason))) throw new Error("Invalid cleanup record");
      return saved;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("封面缓存配置无法读取，请重新保存容量设置恢复。", { cause: error }); }
  }
  private capacity(settings: Settings) { return settings.capacityMiB === undefined ? this.limits.maxBytes : settings.capacityMiB * 1024 ** 2; }
  private async prune(root: string, folder: string, settings: Settings, reserve = 0, reason: Cleanup["reason"] = "automatic") {
    const files = await this.entries(folder); let bytes = files.reduce((sum, file) => sum + file.bytes, 0), count = files.length;
    let removedFiles = 0, removedBytes = 0;
    for (const file of files) {
      if (bytes + reserve <= this.capacity(settings) && count + (reserve ? 1 : 0) <= this.limits.maxFiles && Date.now() - file.touched < MAX_AGE) continue;
      await unlink(file.path); bytes -= file.bytes; count--;
      removedFiles++; removedBytes += file.bytes;
    }
    if (removedFiles) { settings.lastCleanup = { at: new Date().toISOString(), files: removedFiles, bytes: removedBytes, reason }; await writeJsonAtomic(join(root, "Cache", "thumbnail-settings.json"), settings); }
  }
  private async summary(folder: string, account: string, settings: Settings) {
    const all = await this.entries(folder), own = all.filter(file => file.name.startsWith(`${account}-`));
    return { bytes: own.reduce((sum, file) => sum + file.bytes, 0), files: own.length, workspaceBytes: all.reduce((sum, file) => sum + file.bytes, 0), limitBytes: this.capacity(settings), limitFiles: this.limits.maxFiles, retentionDays: 30, enabled: this.capacity(settings) > 0, lastCleanup: settings.lastCleanup ?? null, checkMode: "on-access" as const };
  }
  configure(root: string, account: string, input: unknown) {
    return this.serial(async () => {
      assertAccount(account); const value = input as { capacityMiB?: unknown } | null;
      const capacity = value?.capacityMiB;
      if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity !== 0 && (capacity < 16 || capacity > 1024)) throw new Error("缓存容量请选择 16–1024 MiB，或设为 0 关闭封面缓存。");
      const folder = await this.folder(root);
      let previous: Settings = {};
      try { previous = await this.settings(root); }
      catch (error) { console.warn("[thumbnail-cache] Replacing unreadable settings:", (error as Error).message); }
      const settings: Settings = { ...previous, capacityMiB: capacity };
      await writeJsonAtomic(join(root, "Cache", "thumbnail-settings.json"), settings);
      await this.prune(root, folder, settings, 0, "settings");
      return this.summary(folder, account, settings);
    });
  }
  get(source: Source) {
    return this.serial(async () => {
      assertAccount(source.account);
      if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("素材校验记录无效。");
      const folder = await this.folder(source.root), settings = await this.settings(source.root); await this.prune(source.root, folder, settings);
      if (!this.capacity(settings)) throw new Error("封面缓存已关闭，仍可打开本地原文件。");
      const key = createHash("sha256").update(`v1:${source.mime}:${source.sha256}`).digest("hex");
      const path = join(folder, `${source.account}-${key}.jpg`);
      try {
        const info = await stat(path);
        if (await realpath(path) !== path || !info.isFile() || info.size > MAX_THUMBNAIL || !info.size) throw new Error("缓存缩略图损坏，请清理缓存后重试。");
        await utimes(path, new Date(), new Date()); return { path, bytes: info.size, cached: true };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const space = await statfs(folder);
      if (space.bavail * space.bsize < this.limits.reserveBytes + MAX_THUMBNAIL) throw new Error("本地空间不足，已暂停生成缩略图；仍可打开原文件。");
      const before = await stat(source.path), jpeg = await this.render(source), after = await stat(source.path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("素材已改变，请重新打开。");
      if (jpeg.length < 4 || jpeg.length > Math.min(MAX_THUMBNAIL, this.capacity(settings)) || jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg.at(-2) !== 255 || jpeg.at(-1) !== 217) throw new Error("本地封面生成失败，原文件保留。");
      await this.prune(source.root, folder, settings, jpeg.length);
      const temporary = join(folder, `.${randomUUID()}.tmp`);
      try { await writeFile(temporary, jpeg, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      return { path, bytes: jpeg.length, cached: false };
    });
  }
  usage(root: string, account: string) {
    return this.serial(async () => {
      assertAccount(account); const folder = await this.folder(root), settings = await this.settings(root); await this.prune(root, folder, settings);
      return this.summary(folder, account, settings);
    });
  }
  clear(root: string, account: string) {
    return this.serial(async () => {
      assertAccount(account); const files = (await this.entries(await this.folder(root))).filter(file => file.name.startsWith(`${account}-`));
      for (const file of files) await unlink(file.path);
      const settings = await this.settings(root);
      if (files.length) { settings.lastCleanup = { at: new Date().toISOString(), files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), reason: "manual" }; await writeJsonAtomic(join(root, "Cache", "thumbnail-settings.json"), settings); }
      return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    });
  }
}
