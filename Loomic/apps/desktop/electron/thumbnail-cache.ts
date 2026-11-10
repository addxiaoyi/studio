import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, stat, statfs, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertAccount } from "./workspace-index.js";

type Source = { root: string; account: string; path: string; mime: string; sha256: string };
type Limits = { maxBytes: number; maxFiles: number; reserveBytes: number };
const DEFAULTS: Limits = { maxBytes: 128 * 1024 ** 2, maxFiles: 1000, reserveBytes: 512 * 1024 ** 2 };
const MAX_THUMBNAIL = 256 * 1024;
const MAX_AGE = 30 * 24 * 60 * 60_000;
const ENTRY = /^[a-f\d-]{36}-[a-f0-9]{64}\.jpg$/;

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
  private async prune(folder: string, reserve = 0) {
    const files = await this.entries(folder); let bytes = files.reduce((sum, file) => sum + file.bytes, 0), count = files.length;
    for (const file of files) {
      if (bytes + reserve <= this.limits.maxBytes && count + (reserve ? 1 : 0) <= this.limits.maxFiles && Date.now() - file.touched < MAX_AGE) continue;
      await unlink(file.path); bytes -= file.bytes; count--;
    }
  }
  get(source: Source) {
    return this.serial(async () => {
      assertAccount(source.account);
      if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("素材校验记录无效。");
      const folder = await this.folder(source.root); await this.prune(folder);
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
      if (jpeg.length < 4 || jpeg.length > Math.min(MAX_THUMBNAIL, this.limits.maxBytes) || jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg.at(-2) !== 255 || jpeg.at(-1) !== 217) throw new Error("本地封面生成失败，原文件保留。");
      await this.prune(folder, jpeg.length);
      const temporary = join(folder, `.${randomUUID()}.tmp`);
      try { await writeFile(temporary, jpeg, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      return { path, bytes: jpeg.length, cached: false };
    });
  }
  usage(root: string, account: string) {
    return this.serial(async () => {
      assertAccount(account); const folder = await this.folder(root); await this.prune(folder);
      const all = await this.entries(folder), own = all.filter(file => file.name.startsWith(`${account}-`));
      return { bytes: own.reduce((sum, file) => sum + file.bytes, 0), files: own.length, workspaceBytes: all.reduce((sum, file) => sum + file.bytes, 0), limitBytes: this.limits.maxBytes, limitFiles: this.limits.maxFiles, retentionDays: 30 };
    });
  }
  clear(root: string, account: string) {
    return this.serial(async () => {
      assertAccount(account); const files = (await this.entries(await this.folder(root))).filter(file => file.name.startsWith(`${account}-`));
      for (const file of files) await unlink(file.path);
      return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    });
  }
}
