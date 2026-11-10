import { randomUUID } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { DesktopSetup } from "./desktop-setup.js";
import { assertAccount } from "./workspace-index.js";
import { ScanJournal, type ScanProgress } from "./workspace-scan-journal.js";
import { StorageState } from "./storage-state.js";
import { ScanRate, scanRate } from "./scan-rate.js";
import { WorkspaceDisconnected, WorkspaceDevice } from "./workspace-device.js";

type File = { id: string; path: string; relativePath: string; name: string; bytes: number; inode: string; mtime: number; ctime: number; candidate: boolean };
const FILE_LIMIT = 25000;
const TYPES = ["media", "projects", "exports", "cache", "other"] as const;

export class WorkspaceUsage {
  private controller?: AbortController;
  private starting = false;
  private clearing?: Promise<void>;
  private files = new Map<string, File>();
  private root: string | null = null;
  private current?: ScanProgress;
  private duplicateSets: Set<string>[] = [];
  private rate = new ScanRate(32);
  private rateMiB = 32;
  constructor(private readonly setup: DesktopSetup, private readonly changed?: (state: ScanProgress) => void | Promise<void>) {}
  async settings() {
    const saved = await new StorageState(this.setup.stateDirectory).read("scan-settings") as { rateMiB?: unknown } | null;
    return { rateMiB: saved ? scanRate(saved.rateMiB) : 32 };
  }
  async configure(input: unknown) {
    const rateMiB = scanRate((input as { rateMiB?: unknown } | null)?.rateMiB);
    await new StorageState(this.setup.stateDirectory).write("scan-settings", { rateMiB });
    this.rateMiB = rateMiB; this.rate.setRate(rateMiB);
    return { rateMiB };
  }
  get busy() { return this.starting || Boolean(this.controller) || Boolean(this.clearing); }
  cancel() { this.controller?.abort(); }
  async savedState(account: unknown) {
    await this.clearing;
    assertAccount(account); const setup = await this.setup.status();
    if (!setup.root) throw new Error("本地工作区不可用。");
    if (!setup.available) return ScanJournal.offline(setup.root, account, this.setup.stateDirectory);
    if (this.busy && this.current?.accountId === account) return this.current;
    try { return (await ScanJournal.load(setup.root, account, this.setup.stateDirectory)).progress(); }
    catch (error) { if (error instanceof WorkspaceDisconnected) return ScanJournal.offline(setup.root, account, this.setup.stateDirectory); throw error; }
  }
  async clearProgress(account: unknown) {
    assertAccount(account);
    if (this.busy) throw new Error("请先暂停扫描。");
    this.clearing = (async () => {
      const setup = await this.setup.status();
      if (!setup.available || !setup.root) throw new Error("本地工作区不可用。");
      await ScanJournal.clear(setup.root, account, this.setup.stateDirectory);
    })();
    try { await this.clearing; } finally { this.clearing = undefined; }
  }
  async scan(account: unknown, duplicates: unknown = false) {
    assertAccount(account);
    if (typeof duplicates !== "boolean") throw new Error("扫描选项无效。");
    if (this.busy) throw new Error("正在扫描本地磁盘，请稍候或停止当前扫描。");
    this.starting = true;
    let setup;
    try { setup = await this.setup.status(); }
    finally { this.starting = false; }
    if (!setup.available || !setup.root) throw new WorkspaceDisconnected();
    const root = setup.root, controller = new AbortController(); this.controller = controller;
    this.root = root; this.files.clear(); this.duplicateSets = [];
    const categories = TYPES.map(id => ({ id, bytes: 0, files: 0 }));
    const found: File[] = [], warnings: string[] = [];
    let truncated = false, hashedBytes = 0, readBytes = 0, resumedBytes = 0;
    let journal: ScanJournal | null = null;
    let progress: ScanProgress = { accountId: account, phase: "discovering", fileName: "", fileBytes: 0, fileTotal: 0, verifiedBytes: 0, totalBytes: 0, reusedBytes: 0, updatedAt: new Date().toISOString() };
    const publish = async (change: Partial<ScanProgress>) => {
      progress = { ...progress, ...change, updatedAt: new Date().toISOString() };
      this.current = progress;
      if (journal) await journal.save(progress, progress.phase === "paused" || progress.phase === "completed");
      await this.changed?.(progress);
    };
    try {
      this.rateMiB = (await this.settings()).rateMiB; this.rate.setRate(this.rateMiB);
      const device = await WorkspaceDevice.capture(root);
      if (duplicates) journal = await ScanJournal.load(root, account, this.setup.stateDirectory);
      await publish({ phase: "discovering" });
      const visit = async (folder: string, depth: number): Promise<void> => {
        controller.signal.throwIfAborted();
        if (depth > 20) { truncated = true; return; }
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          controller.signal.throwIfAborted();
          if (found.length >= FILE_LIMIT) { truncated = true; return; }
          const path = join(folder, entry.name), rel = relative(root, path).replaceAll("\\", "/");
          if (rel === "Cache/Scans") continue;
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
      if (duplicates && journal) {
        const activeJournal = journal;
        const sizes = new Map<number, File[]>();
        for (const file of found.filter(file => file.candidate && file.bytes > 0)) { const peers = sizes.get(file.bytes) ?? []; peers.push(file); sizes.set(file.bytes, peers); }
        const candidates = [...sizes.values()].filter(files => files.length > 1).flat();
        journal.retain(candidates);
        const sources = new Map<string, File>();
        for (const file of candidates) if (!sources.has(file.inode) || journal.reuse(file) > journal.reuse(sources.get(file.inode)!)) sources.set(file.inode, file);
        const unique = [...sources.values()];
        resumedBytes = unique.reduce((sum, file) => sum + activeJournal.reuse(file), 0);
        await publish({ phase: "hashing", totalBytes: unique.reduce((sum, file) => sum + file.bytes, 0), verifiedBytes: resumedBytes, reusedBytes: resumedBytes });
        const hashes = new Map<string, string>();
        for (const sameSize of sizes.values()) {
          if (sameSize.length < 2) continue;
          for (const file of sameSize) {
            controller.signal.throwIfAborted();
            let sha = hashes.get(file.inode);
            if (!sha) {
              const source = sources.get(file.inode)!, reused = journal.reuse(source), beforeRead = readBytes;
              try {
                await publish({ fileName: file.name, fileBytes: reused, fileTotal: file.bytes });
                const proof = await journal.hash(source, controller.signal, async (offset, consumed) => { readBytes = beforeRead + consumed; await publish({ fileBytes: offset, verifiedBytes: resumedBytes + readBytes, rateMiB: this.rateMiB }); }, this.rate);
                sha = proof.digest; hashedBytes += file.bytes; hashes.set(file.inode, sha);
              } catch (error) { if (controller.signal.aborted || error instanceof WorkspaceDisconnected) throw error; await device.check(); warnings.push(`${file.relativePath} 内容校验失败，未归为重复素材。`); continue; }
            }
            const key = `${file.bytes}:${sha}`, peers = groups.get(key) ?? []; peers.push(file); groups.set(key, peers);
          }
        }
      }
      const matches = [...groups.values()].filter(files => new Set(files.map(file => file.inode)).size > 1).map(files => ({ bytes: files[0]!.bytes, extraBytes: (new Set(files.map(file => file.inode)).size - 1) * files[0]!.bytes, files: files.map(({ id, name, relativePath, bytes }) => ({ id, name, relativePath, bytes })) })).sort((a, b) => b.extraBytes - a.extraBytes);
      this.duplicateSets = matches.map(group => new Set(group.files.map(file => file.id)));
      await publish({ phase: "completed", fileName: "", fileBytes: 0, fileTotal: 0, verifiedBytes: hashedBytes });
      return { categories, totalBytes: categories.reduce((sum, row) => sum + row.bytes, 0), totalFiles: found.length, duplicates: matches.slice(0, 100), duplicateGroups: matches.length, duplicateBytes: matches.reduce((sum, row) => sum + row.extraBytes, 0), hashedBytes, readBytes, resumedBytes, truncated, warnings: warnings.slice(0, 30), scannedAt: new Date().toISOString() };
    } catch (error) {
      progress = { ...progress, phase: "paused", updatedAt: new Date().toISOString(), disconnected: error instanceof WorkspaceDisconnected };
      this.current = progress;
      if (journal) await journal.saveProfile(progress);
      await this.changed?.(progress);
      if (controller.signal.aborted) throw new Error("扫描已暂停，分块进度已保存在本地；重启后可继续。");
      throw error;
    } finally { this.controller = undefined; }
  }
  async mergeFiles(account: string, ids: string[]) {
    assertAccount(account);
    if (this.busy || ids.length < 2 || ids.length > 200 || new Set(ids).size !== ids.length || !this.duplicateSets.some(group => ids.every(id => group.has(id)))) throw new Error("重复素材记录已失效，请重新扫描并选择同组文件。");
    const setup = await this.setup.status();
    if (!setup.available || setup.root !== this.root) throw new Error("工作区已改变，请重新扫描。");
    const files = ids.map(id => this.files.get(id)!);
    if (files.some(file => !file.relativePath.startsWith(`Media/${account}/`))) throw new Error("合并仅支持当前账户的素材目录；导出成片请单独管理。");
    return files;
  }
  async reveal(id: unknown) {
    const file = typeof id === "string" ? this.files.get(id) : undefined, setup = await this.setup.status();
    if (!file || !setup.available || setup.root !== this.root || !file.candidate) throw new Error("扫描记录已失效，请重新扫描。");
    if (await realpath(file.path) !== file.path || (await stat(file.path)).size !== file.bytes) throw new Error("文件已改变，请重新扫描。");
    return file.path;
  }
}
