import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const MAX_PREVIEW_BYTES = 250 * 1024 * 1024;
const MAX_DIRECT_PREVIEW_BYTES = 64 * 1024 * 1024;
const MIN_PREVIEW_FREE_BYTES = 512 * 1024 * 1024;
const PREVIEW_SPACE_HEADROOM_BYTES = 128 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type PreviewRecord = { path: string; dev: number; ino: number; size: number; mtimeMs: number; previewPath?: string; createdAt: string };
export type VideoPreviewProgress = { state: "starting" | "running" | "completed" | "failed"; sourceBytes?: number; outTimeMs?: number; error?: string };
type RenderPreview = (sourcePath: string, previewPath: string, report: (event: VideoPreviewProgress) => void, signal: AbortSignal) => Promise<void>;

export function requiredPreviewFreeBytes(sourceBytes: number): number {
  const estimated = Math.ceil(Math.max(0, sourceBytes) * 0.1) + PREVIEW_SPACE_HEADROOM_BYTES;
  return Math.max(MIN_PREVIEW_FREE_BYTES, Math.min(MAX_PREVIEW_BYTES * 2, estimated));
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

async function assertPreviewCapacity(directory: string, sourceBytes: number): Promise<void> {
  const capacity = await statfs(directory);
  const freeBytes = Number(capacity.bavail) * Number(capacity.bsize);
  const requiredBytes = requiredPreviewFreeBytes(sourceBytes);
  if (!Number.isFinite(freeBytes) || freeBytes < requiredBytes) {
    throw new Error(`Not enough local disk space for a video preview. Free ${formatBytes(freeBytes)}; required ${formatBytes(requiredBytes)}.`);
  }
}

async function readPreviewBytes(file: FileHandle, expectedSize: number): Promise<ArrayBuffer> {
  if (expectedSize > MAX_PREVIEW_BYTES) throw new Error("Generated preview is too large.");
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, expectedSize - total));
    if (!chunk.length) break;
    const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
    if (!bytesRead) break;
    total += bytesRead;
    chunks.push(chunk.subarray(0, bytesRead));
  }
  if (total !== expectedSize) throw new Error("Export preview changed while it was being read.");
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return bytes.buffer;
}

export class VideoExportPreviews {
  private readonly paths = new Map<string, PreviewRecord>();

  constructor(
    private readonly storeDirectory?: string,
    private readonly allowedDirectory?: () => Promise<string>,
    private readonly renderPreview?: RenderPreview,
    private readonly reportProgress?: (event: VideoPreviewProgress) => void,
  ) {}

  private async checkDirectory(path: string): Promise<void> {
    if (!this.allowedDirectory) return;
    const root = await realpath(await this.allowedDirectory());
    const allowedName = /^video-(?:export|preview)-[0-9a-f-]{36}\.mp4$/i;
    if (dirname(path) !== root || !allowedName.test(basename(path))) throw new Error("Exported video is outside the current local asset folder.");
  }

  private async getRecord(id: string): Promise<PreviewRecord | undefined> {
    if (!UUID.test(id)) return undefined;
    let record = this.paths.get(id);
    if (!record && this.storeDirectory) {
      let content: string;
      try { content = await readFile(join(this.storeDirectory, `${id}.json`), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
      const value: unknown = JSON.parse(content);
      if (!value || typeof value !== "object") throw new Error("Export history record is invalid.");
      const item = value as Record<string, unknown>;
      if (typeof item.path !== "string" || typeof item.createdAt !== "string" || (item.previewPath !== undefined && typeof item.previewPath !== "string") || ![item.dev, item.ino, item.size, item.mtimeMs].every((part) => typeof part === "number" && Number.isFinite(part))) throw new Error("Export history record is invalid.");
      record = item as PreviewRecord;
      this.paths.set(id, record);
    }
    if (record) {
      await this.checkDirectory(record.path);
      if (record.previewPath) await this.checkDirectory(record.previewPath);
    }
    return record;
  }

  async list(): Promise<Array<{ id: string; path: string; createdAt: string }>> {
    if (!this.storeDirectory) return [];
    let names: string[];
    try { names = await readdir(this.storeDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const currentRoot = this.allowedDirectory ? await realpath(await this.allowedDirectory()) : null;
    const records = [];
    for (const name of names) {
      if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
      const id = name.slice(0, -5);
      try {
        const record = await this.getRecord(id);
        if (record && (!currentRoot || dirname(record.path) === currentRoot)) records.push({ id, path: record.path, createdAt: record.createdAt });
      } catch (error) {
        if (error instanceof Error && error.message === "Exported video is outside the current local asset folder.") continue;
        throw error;
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
  }

  async register(path: string, signal?: AbortSignal): Promise<string> {
    const resolved = await realpath(path);
    await this.checkDirectory(resolved);
    const file = await open(resolved, "r");
    let info;
    try { info = await file.stat(); } finally { await file.close(); }
    if (!info.isFile()) throw new Error("Exported video is unavailable.");
    const id = randomUUID();
    let previewPath: string | undefined;
    if (this.renderPreview && info.size > MAX_DIRECT_PREVIEW_BYTES) {
      previewPath = join(dirname(resolved), `video-preview-${id}.mp4`);
      try {
        signal?.throwIfAborted();
        await assertPreviewCapacity(dirname(resolved), info.size);
        this.reportProgress?.({ state: "starting", sourceBytes: info.size });
        await this.renderPreview(resolved, previewPath, event => this.reportProgress?.({ ...event, sourceBytes: info.size }), signal ?? new AbortController().signal);
        signal?.throwIfAborted();
        this.reportProgress?.({ state: "completed", sourceBytes: info.size });
        await this.checkDirectory(previewPath);
        const previewInfo = await stat(previewPath);
        if (!previewInfo.isFile() || !previewInfo.size || previewInfo.size > MAX_PREVIEW_BYTES) throw new Error("Generated preview is unavailable or too large.");
      } catch (error) {
        this.reportProgress?.({ state: "failed", sourceBytes: info.size, error: error instanceof Error ? error.message : "Preview generation failed." });
        await rm(previewPath, { force: true });
        throw new Error("A low-resolution preview could not be generated.", { cause: error });
      }
    }
    const record = { path: resolved, dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ...(previewPath ? { previewPath } : {}), createdAt: new Date().toISOString() };
    try {
      if (this.storeDirectory) {
        await mkdir(this.storeDirectory, { recursive: true });
        await writeFile(join(this.storeDirectory, `${id}.json`), JSON.stringify(record), { encoding: "utf8", flag: "wx" });
      }
    } catch (error) {
      if (previewPath) await rm(previewPath, { force: true });
      throw error;
    }
    this.paths.set(id, record);
    return id;
  }

  async read(id: unknown): Promise<ArrayBuffer> {
    if (typeof id !== "string") throw new Error("Invalid exported video identifier.");
    const registered = await this.getRecord(id);
    if (!registered) throw new Error("Exported video is no longer available. Export it again to preview.");
    if (await realpath(registered.path) !== registered.path) throw new Error("Exported video location changed.");
    const file = await open(registered.path, "r");
    try {
      const info = await file.stat();
      if (info.dev !== registered.dev || info.ino !== registered.ino || info.size !== registered.size || info.mtimeMs !== registered.mtimeMs) throw new Error("Exported video changed since it was saved.");
      if (!info.isFile() || !info.size) throw new Error("Video is unavailable or too large to preview in the app.");
      const previewPath = registered.previewPath ?? registered.path;
      if (await realpath(previewPath) !== previewPath) throw new Error("Export preview location changed.");
      const previewFile = previewPath === registered.path ? file : await open(previewPath, "r");
      try {
        const previewInfo = previewPath === registered.path ? info : await previewFile.stat();
        if (!previewInfo.isFile() || !previewInfo.size || previewInfo.size > MAX_PREVIEW_BYTES) throw new Error("Video is unavailable or too large to preview in the app.");
        if (previewPath !== registered.path) {
          const bytes = await readPreviewBytes(previewFile, previewInfo.size);
          const afterPreview = await previewFile.stat();
          if (afterPreview.size !== previewInfo.size || afterPreview.mtimeMs !== previewInfo.mtimeMs) throw new Error("Export preview changed while it was being read.");
          return bytes;
        }
      } finally {
        if (previewPath !== registered.path) await previewFile.close();
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, MAX_PREVIEW_BYTES + 1 - total));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > MAX_PREVIEW_BYTES) throw new Error("Video is too large to preview in the app.");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await file.stat();
      if (total !== registered.size || after.size !== registered.size || after.mtimeMs !== registered.mtimeMs) throw new Error("Exported video changed while it was being read.");
      const bytes = new Uint8Array(total);
      let position = 0;
      for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
      return bytes.buffer;
    } finally {
      await file.close();
    }
  }
}
