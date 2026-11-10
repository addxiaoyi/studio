import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./desktop-setup.js";
import { assertAccount } from "./workspace-index.js";
import { StorageState, storageKey } from "./storage-state.js";
import { WorkspaceDevice, WorkspaceDisconnected } from "./workspace-device.js";
import type { ScanRate } from "./scan-rate.js";

export const SCAN_BLOCK_BYTES = 4 * 1024 ** 2;
const START_DIGEST = createHash("sha256").update("helstera-content-blocks-v1").digest("hex");
export type ScanProgress = { accountId: string; phase: "discovering" | "hashing" | "paused" | "completed"; fileName: string; fileBytes: number; fileTotal: number; verifiedBytes: number; totalBytes: number; reusedBytes: number; updatedAt: string; rateMiB?: number; disconnected?: boolean };
export type FileProof = { path: string; relativePath: string; bytes: number; inode: string; mtime: number; ctime: number };
type Checkpoint = { fingerprint: string; bytes: number; offset: number; digest: string };
type Journal = { version: 1; accountId: string; progress: ScanProgress; entries: Record<string, Checkpoint>; device?: { dev: string; ino: string } };
const fingerprint = (file: FileProof) => `${file.inode}:${file.bytes}:${file.mtime}:${file.ctime}`;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export class ScanJournal {
  private lastWrite = 0;
  private constructor(private readonly path: string, private readonly saved: Journal, private readonly device: WorkspaceDevice, private readonly mirror: StorageState, private readonly key: string) {}
  static async clear(root: string, account: string, directory: string) {
    assertAccount(account);
    const folder = join(root, "Cache", "Scans");
    await mkdir(folder, { recursive: true });
    if (await realpath(folder) !== folder) throw new Error("扫描记录目录不能是链接。");
    await unlink(join(folder, `${account}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
    await new StorageState(directory).clear(storageKey("scan", root, account));
  }
  private static validate(value: unknown, accountId: string): Journal {
    const saved = value as Journal;
    if (!saved || saved.version !== 1 || saved.accountId !== accountId || !saved.progress || !["discovering", "hashing", "paused", "completed"].includes(saved.progress.phase) || !saved.entries || typeof saved.entries !== "object" || Array.isArray(saved.entries) || Object.keys(saved.entries).length > 25000) throw new Error("Invalid scan journal");
    const p = saved.progress;
    if (saved.device && ![saved.device.dev, saved.device.ino].every(value => typeof value === "string" && /^\d{1,30}$/.test(value))) throw new Error("Invalid workspace identity");
    if (p.accountId !== accountId || typeof p.fileName !== "string" || p.fileName.length > 1024 || ![p.fileBytes, p.fileTotal, p.verifiedBytes, p.totalBytes, p.reusedBytes].every(integer) || p.fileBytes > p.fileTotal || typeof p.updatedAt !== "string" || !Number.isFinite(Date.parse(p.updatedAt))) throw new Error("Invalid progress");
    for (const entry of Object.values(saved.entries)) if (!entry || !integer(entry.bytes) || !integer(entry.offset) || entry.offset > entry.bytes || entry.offset < entry.bytes && entry.offset % SCAN_BLOCK_BYTES !== 0 || typeof entry.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.digest)) throw new Error("Invalid checkpoint");
    return saved;
  }
  static async offline(root: string, account: string, directory: string): Promise<ScanProgress | null> {
    assertAccount(account);
    const saved = await new StorageState(directory).read(storageKey("scan", root, account));
    if (!saved) return null;
    return { ...this.validate(saved, account).progress, phase: "paused", disconnected: true };
  }
  static async load(root: string, accountId: string, directory: string) {
    assertAccount(accountId);
    const device = await WorkspaceDevice.capture(root), mirror = new StorageState(directory), key = storageKey("scan", root, accountId);
    const local = await mirror.read(key), cached = local ? this.validate(local, accountId) : null;
    if (cached?.device && (cached.device.dev !== device.identity.dev || cached.device.ino !== device.identity.ino)) throw new WorkspaceDisconnected();
    const folder = join(root, "Cache", "Scans"); await mkdir(folder, { recursive: true });
    if (await realpath(folder) !== folder) throw new Error("扫描记录目录不能是链接。");
    const path = join(folder, `${accountId}.json`);
    let saved: Journal | null = null;
    try {
      if (await realpath(path) !== path || (await stat(path)).size > 32 * 1024 ** 2) throw new Error("Invalid scan journal");
      saved = this.validate(JSON.parse(await readFile(path, "utf8")), accountId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("本地扫描记录无法读取，请清除扫描进度后重试；素材原文件不受影响。", { cause: error });
    }
    if (cached && (!saved || cached.progress.updatedAt > saved.progress.updatedAt)) saved = cached;
    if (saved) saved.device = device.identity;
    return new ScanJournal(path, saved ?? { version: 1, accountId, progress: { accountId, phase: "paused", fileName: "", fileBytes: 0, fileTotal: 0, verifiedBytes: 0, totalBytes: 0, reusedBytes: 0, updatedAt: "" }, entries: {} }, device, mirror, key);
  }
  progress(): ScanProgress | null {
    if (!this.saved.progress.updatedAt) return null;
    return { ...this.saved.progress, accountId: this.saved.accountId, phase: this.saved.progress.phase === "completed" ? "completed" : "paused" };
  }
  reuse(file: FileProof) {
    const entry = this.saved.entries[file.relativePath];
    return entry?.fingerprint === fingerprint(file) && entry.bytes === file.bytes ? entry.offset : 0;
  }
  retain(files: FileProof[]) {
    const valid = new Set(files.map(file => file.relativePath));
    for (const name of Object.keys(this.saved.entries)) if (!valid.has(name)) delete this.saved.entries[name];
  }
  async save(progress: ScanProgress, force = false) {
    this.saved.progress = progress;
    this.saved.device = this.device.identity;
    if (!force && Date.now() - this.lastWrite < 1000) return;
    await this.mirror.write(this.key, this.saved);
    await this.device.check();
    try { await writeJsonAtomic(this.path, this.saved); }
    catch (error) { throw new WorkspaceDisconnected(error); }
    this.lastWrite = Date.now();
  }
  async saveProfile(progress: ScanProgress) { this.saved.progress = progress; this.saved.device = this.device.identity; await this.mirror.write(this.key, this.saved); }
  async hash(file: FileProof, signal: AbortSignal, checkpoint: (offset: number, read: number) => Promise<void>, rate: ScanRate) {
    const previous = this.saved.entries[file.relativePath];
    const resumed = this.reuse(file), entry: Checkpoint = resumed && previous ? { ...previous } : { fingerprint: fingerprint(file), bytes: file.bytes, offset: 0, digest: START_DIGEST };
    if (await realpath(file.path) !== file.path) throw new Error("文件路径已改变。");
    const handle = await open(file.path, "r");
    let readBytes = 0;
    try {
      const info = await handle.stat();
      if (info.size !== file.bytes || info.mtimeMs !== file.mtime || info.ctimeMs !== file.ctime) throw new Error("文件已改变。");
      const buffer = Buffer.alloc(Math.min(SCAN_BLOCK_BYTES, file.bytes));
      while (entry.offset < file.bytes) {
        signal.throwIfAborted();
        const length = Math.min(buffer.length, file.bytes - entry.offset); let read = 0;
        await rate.reserve(length, signal); await this.device.check();
        while (read < length) {
          signal.throwIfAborted();
          const chunk = await handle.read(buffer, read, length - read, entry.offset + read);
          if (!chunk.bytesRead) throw new Error("文件读取不完整。"); read += chunk.bytesRead;
        }
        const chunkDigest = createHash("sha256").update(buffer.subarray(0, length)).digest();
        entry.digest = createHash("sha256").update(Buffer.from(entry.digest, "hex")).update(chunkDigest).digest("hex");
        entry.offset += length; readBytes += length;
        this.saved.entries[file.relativePath] = { ...entry };
        await checkpoint(entry.offset, readBytes);
      }
      const after = await handle.stat();
      if (after.size !== file.bytes || after.mtimeMs !== file.mtime || after.ctimeMs !== file.ctime) { delete this.saved.entries[file.relativePath]; throw new Error("文件在扫描过程中改变。"); }
      this.saved.entries[file.relativePath] = entry;
      return { digest: entry.digest, readBytes, resumedBytes: resumed };
    } finally { await handle.close(); }
  }
}
