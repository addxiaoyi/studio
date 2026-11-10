import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { DesktopSetup } from "./desktop-setup.js";
import { assertAccount } from "./workspace-index.js";

type File = { id: string; path: string; relativePath: string; name: string; bytes: number; inode: string; mtime: number; ctime: number; candidate: boolean };
const FILE_LIMIT = 25000, HASH_LIMIT = 4 * 1024 ** 3;
const TYPES = ["media", "projects", "exports", "cache", "other"] as const;

export class WorkspaceUsage {
  private controller?: AbortController;
  private files = new Map<string, File>();
  private root: string | null = null;
  constructor(private readonly setup: DesktopSetup) {}
  get busy() { return Boolean(this.controller); }
  cancel() { this.controller?.abort(); }
  async scan(account: unknown, duplicates: unknown = false) {
    assertAccount(account);
    if (typeof duplicates !== "boolean") throw new Error("扫描选项无效。");
    if (this.busy) throw new Error("正在扫描本地磁盘，请稍候或停止当前扫描。");
    const setup = await this.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用。");
    const root = setup.root, controller = new AbortController(); this.controller = controller;
    this.root = root; this.files.clear();
    const categories = TYPES.map(id => ({ id, bytes: 0, files: 0 }));
    const found: File[] = [], warnings: string[] = [];
    let truncated = false, hashedBytes = 0;
    try {
      const visit = async (folder: string, depth: number): Promise<void> => {
        controller.signal.throwIfAborted();
        if (depth > 20) { truncated = true; return; }
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          controller.signal.throwIfAborted();
          if (found.length >= FILE_LIMIT) { truncated = true; return; }
          const path = join(folder, entry.name), rel = relative(root, path).replaceAll("\\", "/");
          if (entry.isSymbolicLink()) { warnings.push(`${rel} 是链接，未统计其目标。`); continue; }
          try {
            if (await realpath(path) !== path) { warnings.push(`${rel} 路径已改变，已跳过。`); continue; }
            if (entry.isDirectory()) { await visit(path, depth + 1); continue; }
            if (!entry.isFile()) continue;
            const info = await stat(path), part = rel.split("/")[0]!.toLowerCase();
            const category = categories.find(row => row.id === part) ?? categories[4]!;
            category.bytes += info.size; category.files++;
            const file = { id: randomUUID(), path, relativePath: rel, name: basename(path), bytes: info.size, inode: info.ino ? `${info.dev}:${info.ino}` : path, mtime: info.mtimeMs, ctime: info.ctimeMs, candidate: rel.startsWith(`Media/${account}/`) || rel.startsWith("Exports/") };
            found.push(file); this.files.set(file.id, file);
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (["ENOENT", "EACCES", "EPERM"].includes(String((error as NodeJS.ErrnoException).code))) { warnings.push(`${rel} 不可读取，已跳过。`); continue; }
            throw error;
          }
        }
      };
      await visit(root, 0);
      const groups = new Map<string, File[]>();
      if (duplicates) {
        const sizes = new Map<number, File[]>();
        for (const file of found.filter(file => file.candidate && file.bytes > 0)) sizes.set(file.bytes, [...(sizes.get(file.bytes) ?? []), file]);
        const hashes = new Map<string, string>();
        for (const sameSize of sizes.values()) {
          if (sameSize.length < 2) continue;
          for (const file of sameSize) {
            controller.signal.throwIfAborted();
            let sha = hashes.get(file.inode);
            if (!sha) {
              if (hashedBytes + file.bytes > HASH_LIMIT) { truncated = true; continue; }
              const hash = createHash("sha256");
              try {
                for await (const chunk of createReadStream(file.path, { signal: controller.signal })) hash.update(chunk);
                const after = await stat(file.path);
                if (after.size !== file.bytes || after.mtimeMs !== file.mtime || after.ctimeMs !== file.ctime) { warnings.push(`${file.relativePath} 扫描时发生变化，未归为重复素材。`); continue; }
              } catch (error) { if (controller.signal.aborted) throw error; warnings.push(`${file.relativePath} 内容校验失败，未归为重复素材。`); continue; }
              hashedBytes += file.bytes; sha = hash.digest("hex"); hashes.set(file.inode, sha);
            }
            const key = `${file.bytes}:${sha}`; groups.set(key, [...(groups.get(key) ?? []), file]);
          }
        }
      }
      const matches = [...groups.values()].filter(files => new Set(files.map(file => file.inode)).size > 1).map(files => ({ bytes: files[0]!.bytes, extraBytes: (new Set(files.map(file => file.inode)).size - 1) * files[0]!.bytes, files: files.map(({ id, name, relativePath, bytes }) => ({ id, name, relativePath, bytes })) })).sort((a, b) => b.extraBytes - a.extraBytes);
      return { categories, totalBytes: categories.reduce((sum, row) => sum + row.bytes, 0), totalFiles: found.length, duplicates: matches.slice(0, 100), duplicateGroups: matches.length, duplicateBytes: matches.reduce((sum, row) => sum + row.extraBytes, 0), hashedBytes, truncated, warnings: warnings.slice(0, 30), scannedAt: new Date().toISOString() };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("扫描已停止，磁盘上的文件未改变。");
      throw error;
    } finally { this.controller = undefined; }
  }
  async reveal(id: unknown) {
    const file = typeof id === "string" ? this.files.get(id) : undefined, setup = await this.setup.status();
    if (!file || !setup.available || setup.root !== this.root || !file.candidate) throw new Error("扫描记录已失效，请重新扫描。");
    if (await realpath(file.path) !== file.path || (await stat(file.path)).size !== file.bytes) throw new Error("文件已改变，请重新扫描。");
    return file.path;
  }
}
