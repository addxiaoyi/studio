import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { DesktopSetup } from "./desktop-setup.js";
import { MediaRelink } from "./media-relink.js";
import { assertAccount, readWorkspaceIndex } from "./workspace-index.js";
import { workspaceReceiptPath, type WorkspaceReceipt } from "./workspace-receipt.js";
import { RelinkDraftStore, relinkChoices, type DirectoryPlan as Plan, type RelinkMatch as Match, type RelinkDraft as Pending } from "./relink-draft.js";

const LIMIT = 25000;
const FORMAT = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|ogg)$/i;
const extension = (path: string) => extname(path).toLowerCase().replace(".jpeg", ".jpg");
const within = (root: string, path: string) => { const tail = relative(root, path); return tail === "" || !isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`); };

export class MediaRelinkBatch {
  private pending?: Pending;
  private controller?: AbortController;
  private applying = false;
  private writing = false;
  constructor(private readonly setup: DesktopSetup) {}
  private get drafts() { return new RelinkDraftStore(this.setup.stateDirectory); }
  async resume(account: unknown) {
    assertAccount(account);
    if (this.busy) throw new Error("目录核对正在进行，请稍后读取预览。");
    const setup = await this.setup.status();
    if (!setup.root) return null;
    const saved = await this.drafts.read(setup.root, account);
    if (saved) this.pending = saved;
    return saved?.plan ?? null;
  }
  async discard(account: unknown) {
    assertAccount(account); if (this.busy) throw new Error("请先完成当前目录操作。");
    const setup = await this.setup.status();
    if (setup.root) await this.drafts.clear(setup.root, account);
    if (this.pending?.account === account) this.pending = undefined;
  }
  async saveSelection(id: unknown, choices: unknown) {
    if (this.busy || !this.pending || this.pending.plan.id !== id) throw new Error("目录预览已改变，请重新打开。");
    this.writing = true;
    try {
      const selections = relinkChoices(this.pending.plan, choices);
      const draft = { ...this.pending, plan: { ...this.pending.plan, selections } };
      await this.drafts.save(draft); this.pending = draft;
    } finally { this.writing = false; }
  }
  get busy() { return Boolean(this.controller) || this.applying || this.writing; }
  cancel() { this.controller?.abort(); }
  async prepare(account: unknown, directory: string): Promise<Plan> {
    assertAccount(account);
    if (this.busy) throw new Error("正在核对目录，请稍候或取消。");
    const controller = new AbortController(); this.controller = controller; this.pending = undefined;
    try {
      const setup = await this.setup.status();
      if (!setup.available || !setup.root) throw new Error("本地工作区不可用。");
      const root = setup.root, own = join(root, "Media", account), media = join(root, "Media");
      if (!isAbsolute(directory) || await realpath(directory) !== directory || !(await stat(directory)).isDirectory()) throw new Error("请选择真实目录，不要选择链接。");
      if (within(media, directory) && directory !== media && !within(own, directory)) throw new Error("不能读取其他账户目录。");
      const index = await readWorkspaceIndex(root, account), assets = index.items.filter(item => item.key.startsWith("asset:"));
      if (assets.length > LIMIT) throw new Error("素材索引超过 25000 项，请按工作区整理后重试。");
      const receipts = new Map<string, WorkspaceReceipt>(), paths = new Map<string, string>();
      const wanted = new Map<string, Match[]>();
      const items: Match[] = assets.map(item => {
        const assetId = item.key.slice(6), receipt = item.receipt;
        const row: Match = { assetId, name: typeof item.name === "string" ? item.name : basename(receipt?.path ?? assetId), bytes: receipt?.bytes ?? 0, status: "invalid", candidates: [] };
        assertAccount(assetId);
        if (!receipt || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !FORMAT.test(receipt.path)) return row;
        receipts.set(assetId, receipt); row.status = "missing";
        const key = `${receipt.bytes}:${extension(receipt.path)}`;
        wanted.set(key, [...(wanted.get(key) ?? []), row]); return row;
      });
      const warnings: string[] = []; let count = 0, matchedPaths = 0, truncated = false;
      const warn = (message: string) => { if (warnings.length < 30) warnings.push(message); };
      const visit = async (folder: string, depth: number): Promise<void> => {
        controller.signal.throwIfAborted();
        if (depth > 20 || count >= LIMIT) { truncated = true; return; }
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          controller.signal.throwIfAborted();
          if (++count > LIMIT) { truncated = true; return; }
          const path = join(folder, entry.name), label = relative(directory, path);
          if (within(media, path) && path !== media && !within(own, path)) continue;
          if (entry.isSymbolicLink()) { warn(`${label} 是链接，已跳过。`); continue; }
          try {
            if (await realpath(path) !== path) { warn(`${label} 路径已改变。`); continue; }
            if (entry.isDirectory()) { await visit(path, depth + 1); continue; }
            if (!entry.isFile() || !FORMAT.test(path)) continue;
            const before = await stat(path), rows = wanted.get(`${before.size}:${extension(path)}`);
            if (!rows) continue;
            const hash = createHash("sha256");
            for await (const chunk of createReadStream(path, { signal: controller.signal, highWaterMark: 1024 ** 2 })) hash.update(chunk);
            const digest = hash.digest("hex"), after = await stat(path);
            if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) { warn(`${label} 扫描期间已改变。`); continue; }
            const candidate = { id: randomUUID(), name: basename(path), relativePath: label, willCopy: !within(own, path) };
            paths.set(candidate.id, path);
            for (const row of rows) if (receipts.get(row.assetId)!.sha256 === digest) {
              if (row.candidates.length >= 20 || matchedPaths >= LIMIT) { truncated = true; continue; }
              row.candidates.push(candidate); matchedPaths++;
            }
          } catch (error) {
            if (controller.signal.aborted) throw error;
            warn(`${label} 无法校验：${(error as Error).message}`);
          }
        }
      };
      await visit(directory, 0);
      for (const row of items) {
        if (row.status === "invalid") continue;
        const original = workspaceReceiptPath(root, "Media", account, receipts.get(row.assetId));
        row.status = row.candidates.some(candidate => paths.get(candidate.id) === original) ? "unchanged" : row.candidates.length > 1 ? "ambiguous" : row.candidates.length ? "matched" : "missing";
      }
      const plan: Plan = { id: randomUUID(), folder: directory, items, warnings, truncated, savedAt: new Date().toISOString(), selections: [] };
      this.pending = { plan, root, account, paths, receipts, expires: Date.now() + 7 * 24 * 60 * 60_000 };
      await this.drafts.save(this.pending);
      return plan;
    } catch (error) { if (controller.signal.aborted) throw new Error("目录核对已取消，素材关联未修改。"); throw error; }
    finally { this.controller = undefined; }
  }
  async apply(id: unknown, input: unknown) {
    if (this.busy) throw new Error("正在关联素材，请稍候。");
    const pending = this.pending;
    if (!pending || pending.plan.id !== id || pending.expires < Date.now()) throw new Error("目录预览已失效，请重新核对。");
    const selected = relinkChoices(pending.plan, input).map(entry => ({ assetId: entry.assetId, path: pending.paths.get(entry.candidateId)! }));
    if (!selected.length) throw new Error("请逐项选择要关联的素材。");
    this.applying = true;
    const items: Array<{ assetId: string; ok: boolean; filename?: string; error?: string }> = [];
    try {
      const setup = await this.setup.status();
      if (!setup.available || setup.root !== pending.root) throw new Error("工作区已改变，请重新核对目录。");
      const relink = new MediaRelink(this.setup);
      for (const item of selected) {
        try {
          const index = await readWorkspaceIndex(pending.root, pending.account), receipt = index.items.find(row => row.key === `asset:${item.assetId}`)?.receipt;
          if (JSON.stringify(receipt) !== JSON.stringify(pending.receipts.get(item.assetId))) throw new Error("素材索引已改变，请重新核对。");
          const plan = await relink.prepare(pending.account, item.assetId, item.path), saved = await relink.apply(plan.id);
          const row = pending.plan.items.find(row => row.assetId === item.assetId)!;
          row.status = "unchanged"; pending.plan.selections = pending.plan.selections.filter(choice => choice.assetId !== item.assetId);
          try { await this.drafts.save(pending); }
          catch (error) { throw new Error("素材已关联，但预览进度保存失败，请重新核对目录。", { cause: error }); }
          items.push({ assetId: item.assetId, ok: true, filename: saved.filename });
        } catch (error) { items.push({ assetId: item.assetId, ok: false, error: (error as Error).message }); }
      }
      if (items.every(item => item.ok)) { await this.drafts.clear(pending.root, pending.account); this.pending = undefined; }
      return { items };
    } finally { this.applying = false; }
  }
}
