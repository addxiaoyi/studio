import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import type { StorageProvider } from "../../storage/storage-provider.js";
import { savePrivateVideoFile } from "./private-video.js";

export const VIDEO_CHUNK_BYTES = 8 * 1024 ** 2;
export const videoUploadSchema = z.object({ bytes: z.number().int().min(12).max(2 * 1024 ** 3), sha256: z.string().regex(/^[a-f0-9]{64}$/), mimeType: z.enum(["video/mp4", "video/webm"]), filename: z.string().min(1).max(160) });
type VideoUpload = z.infer<typeof videoUploadSchema>;
type Owner = { userId: string; workspaceId: string };
type UploadState = VideoUpload & Owner & { uploadId: string; offset: number; expiresAt: number; assetId?: string };
const TTL = 24 * 60 * 60_000;
const RESERVE = 64 * 1024 ** 2;
export class VideoUploadError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export class VideoUploads {
  constructor(private readonly db: Pool, private readonly storage: StorageProvider, private readonly directory: string) {}
  private key(owner: Owner, uploadId: string) { return createHash("sha256").update(`${owner.workspaceId}:${owner.userId}:${uploadId}`).digest("hex"); }
  private async folder(key: string) {
    await mkdir(this.directory, { recursive: true });
    const root = await realpath(this.directory), folder = join(root, key);
    await mkdir(folder, { recursive: true });
    if (await realpath(folder) !== folder) throw new VideoUploadError("上传目录无效。", 409);
    return folder;
  }
  private async locked<T>(key: string, action: () => Promise<T>) {
    const client = await this.db.connect();
    let acquired = false;
    try {
      acquired = (await client.query("select pg_try_advisory_lock(hashtextextended($1,0)) as acquired", [`video-upload:${key}`])).rows[0].acquired;
      if (!acquired) throw new VideoUploadError("此账户有上传正在处理，请稍后继续。", 409);
      return await action();
    } finally {
      try { if (acquired) await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [`video-upload:${key}`]); }
      finally { client.release(); }
    }
  }
  private async read(folder: string): Promise<UploadState | null> {
    try {
      const path = join(folder, "state.json");
      if (await realpath(path) !== path) throw new VideoUploadError("上传记录无效。", 409);
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  private async checkpoint(folder: string, state: UploadState) {
    const path = join(folder, `${randomUUID()}.tmp`);
    try {
      await writeFile(path, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      const file = await open(path, "r+");
      try { await file.sync(); } finally { await file.close(); }
      await rename(path, join(folder, "state.json"));
    } finally { await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  private status(state: UploadState) { return { offset: state.offset, bytes: state.bytes, chunkBytes: VIDEO_CHUNK_BYTES, expiresAt: new Date(state.expiresAt).toISOString(), assetId: state.assetId ?? null }; }
  private async available(folder: string, owner: Owner) {
    const state = await this.read(folder);
    if (!state || state.userId !== owner.userId || state.workspaceId !== owner.workspaceId) throw new VideoUploadError("上传会话不存在，请重新开始。", 404);
    if (state.expiresAt <= Date.now()) throw new VideoUploadError("续传记录已到期，请重新开始上传。", 410);
    return state;
  }
  private async room(folder: string, bytes: number) {
    const space = await statfs(folder);
    if (space.bavail * space.bsize < bytes + RESERVE) throw new VideoUploadError("云端存储空间不足，本地文件保留，请稍后重试。", 507);
  }
  async begin(owner: Owner, uploadId: string, input: VideoUpload) {
    return this.locked(owner.userId, async () => {
      const folder = await this.folder(this.key(owner, uploadId));
      let state = await this.read(folder);
      if (state && state.expiresAt <= Date.now()) { await rm(folder, { recursive: true }); await mkdir(folder); state = null; }
      if (state) {
        if (state.bytes !== input.bytes || state.sha256 !== input.sha256 || state.mimeType !== input.mimeType) throw new VideoUploadError("该上传标识对应的文件已改变。", 409);
        return this.status(state);
      }
      const root = await realpath(this.directory);
      let count = 0, reserved = 0;
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        const pending = await this.read(join(root, entry.name));
        if (pending?.userId === owner.userId && !pending.assetId && pending.expiresAt > Date.now()) { count++; reserved += pending.bytes; }
      }
      if (count >= 4 || reserved + input.bytes > 4 * 1024 ** 3) throw new VideoUploadError("最多保留四个未完成上传，合计不超过 4 GiB。请先完成或取消已有上传。", 429);
      await this.room(folder, input.bytes * 2);
      state = { ...input, ...owner, uploadId, offset: 0, expiresAt: Date.now() + TTL };
      await this.checkpoint(folder, state);
      return this.status(state);
    });
  }
  async append(owner: Owner, uploadId: string, offset: number, digest: string, bytes: Buffer) {
    return this.locked(owner.userId, async () => {
      const folder = await this.folder(this.key(owner, uploadId)), state = await this.available(folder, owner);
      if (!bytes.length || bytes.length > VIDEO_CHUNK_BYTES || !Number.isSafeInteger(offset) || offset < 0 || offset + bytes.length > state.bytes) throw new VideoUploadError("分片长度或偏移无效。");
      if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new VideoUploadError("分片校验失败，请重试。");
      if (state.assetId) return this.status(state);
      if (offset > state.offset || offset < state.offset && offset + bytes.length > state.offset) throw new VideoUploadError("上传偏移已改变，请读取进度后继续。", 409);
      const path = join(folder, "video.part");
      if (state.offset && await realpath(path) !== path) throw new VideoUploadError("上传文件无效。", 409);
      const file = await open(path, state.offset ? "r+" : "w", 0o600);
      try {
        if (offset < state.offset) {
          const previous = Buffer.alloc(bytes.length); await file.read(previous, 0, previous.length, offset);
          if (!previous.equals(bytes)) throw new VideoUploadError("重复分片内容不一致。", 409);
          return this.status(state);
        }
        if ((await file.stat()).size < state.offset) throw new VideoUploadError("上传片段不完整，请重新开始。", 409);
        await this.room(folder, bytes.length);
        await file.truncate(state.offset);
        let written = 0;
        while (written < bytes.length) written += (await file.write(bytes, written, bytes.length - written, offset + written)).bytesWritten;
        await file.sync();
        state.offset += bytes.length; state.expiresAt = Date.now() + TTL;
        await this.checkpoint(folder, state);
        return this.status(state);
      } finally { await file.close(); }
    });
  }
  async complete(owner: Owner, uploadId: string) {
    return this.locked(owner.userId, async () => {
      const folder = await this.folder(this.key(owner, uploadId)), state = await this.available(folder, owner);
      if (state.assetId) return this.status(state);
      if (state.offset !== state.bytes) throw new VideoUploadError("文件尚未传完，请继续上传。", 409);
      const path = join(folder, "video.part");
      if (await realpath(path) !== path || (await stat(path)).size !== state.bytes) throw new VideoUploadError("上传文件长度异常。", 409);
      const file = await open(path, "r");
      const header = Buffer.alloc(12);
      try { await file.read(header, 0, 12, 0); } finally { await file.close(); }
      if (state.mimeType === "video/mp4" ? header.toString("ascii", 4, 8) !== "ftyp" : header.readUInt32BE(0) !== 0x1a45dfa3) throw new VideoUploadError("文件与所选视频格式不符。");
      await this.room(folder, state.bytes);
      const saved = await savePrivateVideoFile(this.db, this.storage, { ...state, path });
      state.assetId = saved.assetId; state.expiresAt = Date.now() + TTL;
      await this.checkpoint(folder, state);
      await unlink(path);
      return this.status(state);
    });
  }
  async cancel(owner: Owner, uploadId: string) {
    return this.locked(owner.userId, async () => {
      const folder = await this.folder(this.key(owner, uploadId));
      await rm(folder, { recursive: true });
    });
  }
  async cleanup() {
    await mkdir(this.directory, { recursive: true });
    const root = await realpath(this.directory);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const folder = join(root, entry.name), state = await this.read(folder);
      if (!state || state.expiresAt > Date.now()) continue;
      try { await this.locked(state.userId, async () => { const latest = await this.read(folder); if (latest && latest.expiresAt <= Date.now()) await rm(folder, { recursive: true }); }); }
      catch (error) { if (!(error instanceof VideoUploadError && error.status === 409)) throw error; }
    }
  }
}
