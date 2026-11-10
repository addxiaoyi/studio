import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { link, readFile, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { backupAssetIds, videoProjectSchema } from "@helstera/shared";
import { DesktopSetup } from "./desktop-setup.js";
import { fileSha256 } from "./local-download.js";
import { WorkspaceCleanup } from "./workspace-cleanup.js";
import { workspaceReceiptPath } from "./workspace-receipt.js";
import { WorkspaceUsage } from "./workspace-usage.js";
import { WorkspaceDevice } from "./workspace-device.js";
import { assertAccount } from "./workspace-index.js";

type Proof = { path: string; bytes: number; sha256: string; ino: bigint; dev: bigint; mtime: bigint; ctime: bigint; nlink: bigint; mode: bigint; uid: bigint; gid: bigint };
type ProjectRef = { id: string; name: string; kind: "canvas" | "video" };
type MergePlan = { id: string; keep: string; files: string[]; assets: number; projects: ProjectRef[]; bytes: number; expiresAt: string };
type Pending = { plan: MergePlan; root: string; account: string; keep: Proof; files: Proof[]; references: string };
const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const pathKey = (path: string) => process.platform === "win32" ? normalize(path).toLowerCase() : normalize(path);

async function prove(path: string): Promise<Proof> {
  if (await realpath(path) !== path) throw new Error("素材路径已改变，未执行合并。");
  const before = await stat(path, { bigint: true });
  if (!before.isFile() || !before.ino || before.size < 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("无法校验原文件身份。");
  const sha256 = await fileSha256(path), after = await stat(path, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("素材在校验期间已改变。");
  return { path, bytes: Number(after.size), sha256, ino: after.ino, dev: after.dev, mtime: after.mtimeNs, ctime: after.ctimeNs, nlink: after.nlink, mode: after.mode, uid: after.uid, gid: after.gid };
}
async function unchanged(proof: Proof, content = true) {
  const current = await stat(proof.path, { bigint: true });
  if (await realpath(proof.path) !== proof.path || current.ino !== proof.ino || current.dev !== proof.dev || current.size !== BigInt(proof.bytes) || current.mtimeNs !== proof.mtime || current.ctimeNs !== proof.ctime || current.nlink !== proof.nlink || current.mode !== proof.mode || content && await fileSha256(proof.path) !== proof.sha256) throw new Error("原文件已改变，请重新预览；尚未合并的副本保留。");
}
export class MediaMerge {
  private pending?: Pending;
  private running = false;
  constructor(private readonly setup: DesktopSetup, private readonly usage: WorkspaceUsage) {}
  get busy() { return this.running; }
  private async references(account: string, paths: string[]) {
    const scan = await new WorkspaceCleanup(this.setup).references(account), selected = new Set(paths.map(pathKey));
    const ids = new Set(scan.index.items.filter(item => item.key.startsWith("asset:") && selected.has(pathKey(workspaceReceiptPath(scan.root, "Media", account, item.receipt) ?? ""))).map(item => item.key.slice(6)));
    const projects = new Map<string, ProjectRef>();
    for (const snapshot of scan.snapshots) if (backupAssetIds(snapshot.document).some(id => ids.has(id))) projects.set(`canvas:${snapshot.document.project.id}`, { id: snapshot.document.project.id, name: snapshot.document.project.name, kind: "canvas" });
    const directory = this.setup.videoProjectsDirectory, videos: Array<[string, string]> = [];
    let folders: Dirent[];
    try { folders = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; folders = []; }
    if (folders.length > 500) throw new Error("视频工程过多，无法完整核对引用。");
    let totalBytes = 0;
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const path = join(directory, folder.name, "project.json");
      const info = await stat(path); totalBytes += info.size;
      if (await realpath(path) !== path || info.size > 16 * 1024 ** 2 || totalBytes > 128 * 1024 ** 2) throw new Error("视频工程文件无法完整核对，未执行合并。");
      const bytes = await readFile(path), parsed = videoProjectSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success) throw new Error("有无法读取的视频工程，请先恢复或检查工程记录。");
      videos.push([path, digest(bytes)]);
      if (parsed.data.assets.some(asset => ids.has(asset.assetId) || selected.has(pathKey(asset.path)))) projects.set(`video:${parsed.data.projectId}`, { id: parsed.data.projectId, name: parsed.data.title, kind: "video" });
    }
    return { scan, assets: ids.size, projects: [...projects.values()], fingerprint: digest(JSON.stringify([scan.fingerprint, videos.sort()])) };
  }
  async prepare(account: unknown, keepId: unknown, sourceIds: unknown): Promise<MergePlan> {
    assertAccount(account);
    if (this.busy) throw new Error("合并正在进行。");
    if (typeof keepId !== "string" || !Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some(id => typeof id !== "string")) throw new Error("请选择保留原文件与重复副本。");
    this.running = true; this.pending = undefined;
    try {
      const candidates = await this.usage.mergeFiles(account, [keepId, ...sourceIds]);
      const refs = await this.references(account, candidates.map(file => file.path));
      const keep = await prove(candidates[0]!.path), files: Proof[] = [];
      for (const candidate of candidates.slice(1)) {
        const file = await prove(candidate.path);
        if (file.dev === keep.dev && file.ino === keep.ino) continue;
        if (file.dev !== keep.dev || file.sha256 !== keep.sha256 || file.bytes !== keep.bytes) throw new Error("素材内容或磁盘不一致，不能合并。");
        if (file.nlink !== 1n) throw new Error("副本已与其他路径共享磁盘内容，请重新扫描后核对。");
        if (file.mode !== keep.mode || file.uid !== keep.uid || file.gid !== keep.gid) throw new Error("文件权限不同，请先检查原文件权限，未合并副本。");
        files.push(file);
      }
      for (const proof of [keep, ...files]) {
        const receipts = refs.scan.index.items.filter(item => pathKey(workspaceReceiptPath(refs.scan.root, "Media", account, item.receipt) ?? "") === pathKey(proof.path));
        if (receipts.some(item => item.receipt?.sha256 !== proof.sha256 || item.receipt.bytes !== proof.bytes)) throw new Error("素材与保存时的校验记录不一致，请先重新关联正确原文件。");
      }
      if (!files.length) throw new Error("这些文件已共享同一份内容，无需再次合并。");
      const plan = { id: randomUUID(), keep: candidates[0]!.relativePath, files: candidates.slice(1).filter(candidate => files.some(file => file.path === candidate.path)).map(file => file.relativePath), assets: refs.assets, projects: refs.projects, bytes: files.reduce((sum, file) => sum + file.bytes, 0), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
      this.pending = { plan, root: refs.scan.root, account, keep, files, references: refs.fingerprint };
      return plan;
    } finally { this.running = false; }
  }
  async apply(id: unknown, accepted: unknown) {
    if (accepted !== true) throw new Error("请确认引用范围和共享原文件的影响。");
    if (this.busy) throw new Error("合并正在进行。");
    const pending = this.pending;
    if (!pending || pending.plan.id !== id || Date.parse(pending.plan.expiresAt) < Date.now()) throw new Error("合并预览已失效，请重新核对。");
    this.running = true; this.pending = undefined;
    const errors: string[] = []; let mergedFiles = 0, releasedBytes = 0;
    try {
      const refs = await this.references(pending.account, [pending.keep.path, ...pending.files.map(file => file.path)]);
      if (refs.scan.root !== pending.root || refs.fingerprint !== pending.references) throw new Error("工程引用或工作区已改变，请重新预览。");
      const device = await WorkspaceDevice.capture(pending.root);
      await unchanged(pending.keep);
      for (const file of pending.files) await unchanged(file);
      for (const file of pending.files) {
        let temporary: string | undefined;
        try {
          await device.check(); await unchanged(file);
          if (await realpath(dirname(file.path)) !== dirname(file.path)) throw new Error("素材目录已改变。");
          const keeper = await prove(pending.keep.path);
          if (keeper.ino !== pending.keep.ino || keeper.dev !== pending.keep.dev || keeper.sha256 !== pending.keep.sha256) throw new Error("保留的原文件已改变。");
          temporary = join(dirname(file.path), `.${randomUUID()}.merge`);
          await link(pending.keep.path, temporary);
          await unchanged(file, false);
          await rename(temporary, file.path); temporary = undefined;
          mergedFiles++; releasedBytes += file.bytes;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const message = ["ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(code ?? "") ? "当前文件系统不支持共享文件内容，原副本保留。" : ["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ? "文件被占用或没有操作权限，原副本保留；关闭使用它的程序后重试。" : (error as Error).message;
          errors.push(`${basename(file.path)}：${message}`);
        }
        finally { if (temporary) await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      }
      return { mergedFiles, releasedBytes, errors };
    } finally { this.running = false; }
  }
}
