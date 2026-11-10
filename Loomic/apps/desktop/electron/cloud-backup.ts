import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DesktopSetup, writeJsonAtomic } from "./desktop-setup.js";
import { downloadLocalFile, receiptExists, type LocalReceipt } from "./local-download.js";
import { resumeDownload, type DownloadProgress } from "./resumable-download.js";

type BackupItem = { key: string; name: string; state: "saved" | "failed"; receipt?: LocalReceipt; error?: string };
export type BackupState = { status: "idle" | "running" | "completed" | "partial" | "canceled" | "failed"; completed: number; skipped: number; failed: number; current: string; bytes: number; totalBytes: number | null; bytesPerSecond?: number; remainingSeconds?: number | null; resumedBytes?: number; error?: string; account?: string; updatedAt?: string; items: BackupItem[] };
type Credentials = { accessToken: string; accountId: string };
type Asset = { id: string; asset_object_id: string | null; title: string | null; mime_type: string; retention_state?: string };
type Project = { id: string; name: string; primaryCanvas?: { id: string } };
type BackupOptions = { setup: DesktopSetup; origin: () => string; request?: typeof fetch; changed: (state: BackupState) => void };
const emptyState = (): BackupState => ({ status: "idle", completed: 0, skipped: 0, failed: 0, current: "", bytes: 0, totalBytes: null, items: [] });
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

export class CloudBackup {
  private state = emptyState();
  private controller?: AbortController;
  private lastProgress = 0;
  constructor(private readonly options: BackupOptions) {}
  get busy() { return Boolean(this.controller); }
  status() { return this.state; }
  cancel() { this.controller?.abort(); }
  private publish(change: Partial<BackupState>) {
    this.state = { ...this.state, ...change, updatedAt: new Date().toISOString() };
    this.options.changed(this.state);
  }
  private credentials(input: unknown): Credentials {
    const value = input as Partial<Credentials> | null;
    if (!value || !validId(value.accountId) || typeof value.accessToken !== "string" || !value.accessToken || value.accessToken.length > 16384) throw new Error("请先登录后再保存云端数据。");
    return value as Credentials;
  }
  private async accountRoot(credentials: Credentials) {
    const setup = await this.options.setup.status();
    if (!setup.completed || !setup.available || !setup.root) throw new Error("请先完成本地工作区配置。");
    const identity = await this.json("/api/viewer", credentials);
    if ((identity as { profile?: { id?: string } }).profile?.id !== credentials.accountId) throw new Error("登录身份已改变，请刷新后重新保存。");
    return { root: setup.root, account: credentials.accountId };
  }
  private async request(path: string, credentials: Credentials, extraHeaders: Record<string, string> = {}, media = false) {
    const url = new URL(path, this.options.origin());
    if (url.origin !== new URL(this.options.origin()).origin || !url.pathname.startsWith("/api/")) throw new Error("仅可保存当前站点的云端数据。");
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), media ? 30_000 : 120_000);
    const signal = AbortSignal.any([this.controller!.signal, deadline.signal]);
    const response = await (this.options.request ?? fetch)(url, {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Accept-Encoding": "identity", ...extraHeaders },
      credentials: "include", redirect: "error", signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok && !(media && response.status === 416)) throw new Error(response.status === 401 ? "登录已过期，请重新登录后重试。" : `云端文件不可用（${response.status}），请重试。`);
    return response;
  }
  private async json(path: string, credentials: Credentials): Promise<Record<string, unknown>> {
    const response = await this.request(path, credentials);
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("云端数据格式不正确，请稍后重试。");
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("云端数据结构无效。");
    return value as Record<string, unknown>;
  }
  private async folder(root: string, kind: "Media" | "Projects", account: string) {
    const path = join(root, kind, account);
    await mkdir(path, { recursive: true });
    if (await realpath(path) !== path) throw new Error("工作区目录发生变化，请重新选择。");
    return path;
  }
  private progress = (bytes: number, totalBytes: number | null) => {
    if (Date.now() - this.lastProgress < 250) return;
    this.lastProgress = Date.now(); this.publish({ bytes, totalBytes });
  };
  private downloadProgress = (progress: DownloadProgress) => {
    if (Date.now() - this.lastProgress < 250 && progress.bytes !== progress.totalBytes) return;
    this.lastProgress = Date.now(); this.publish(progress);
  };
  async restore(accountId: unknown) {
    if (!validId(accountId)) throw new Error("账户标识无效。");
    if (this.busy) return this.state.account === accountId ? this.state : emptyState();
    const setup = await this.options.setup.status();
    if (!setup.root || !setup.available) return emptyState();
    const path = join(setup.root, "Projects", accountId, "backup-index.json");
    try {
      const saved = JSON.parse(await readFile(path, "utf8")) as BackupState;
      if (saved.account !== accountId || !Array.isArray(saved.items)) throw new Error("Invalid backup index");
      return this.state = { ...saved, ...(saved.status === "running" ? { status: "partial" as const, error: "上次保存被中断，请重试；已保存的文件会校验并跳过。" } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw new Error("本地保存记录无法读取。已有文件仍在工作区中。", { cause: error });
    }
  }
  async run(input: unknown, assetOnly?: unknown): Promise<BackupState> {
    if (this.busy) throw new Error("已有本地保存任务正在进行。");
    const credentials = this.credentials(input);
    const single = assetOnly as { assetId?: unknown; name?: unknown; mediaType?: unknown } | undefined;
    if (single && (!validId(single.assetId) || typeof single.name !== "string" || !["image", "video"].includes(String(single.mediaType)))) throw new Error("素材保存参数无效。");
    this.controller = new AbortController();
    let indexPath: string | undefined;
    let items: BackupItem[] = [];
    this.publish({ ...emptyState(), status: "running", account: credentials.accountId });
    try {
      const { root, account } = await this.accountRoot(credentials);
      const media = await this.folder(root, "Media", account);
      const projects = await this.folder(root, "Projects", account);
      indexPath = join(projects, "backup-index.json");
      let prior: BackupItem[] = [];
      try { const index = JSON.parse(await readFile(indexPath, "utf8")); if (index.account === account && Array.isArray(index.items)) prior = index.items; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("本地保存索引损坏，请先检查工作区文件。"); }
      items = [...prior];
      const checkpoint = async () => { this.publish({ items: [...items] }); await writeJsonAtomic(indexPath!, this.state); };
      const save = async (key: string, name: string, load: (headers?: Record<string, string>) => Promise<Response>, directory: string, mediaType: "image" | "video" | "json") => {
        this.controller!.signal.throwIfAborted();
        this.lastProgress = 0;
        this.publish({ current: name, bytes: 0, totalBytes: null, bytesPerSecond: 0, remainingSeconds: null, resumedBytes: 0 });
        const previous = items.find(item => item.key === key);
        try {
          const receipt = previous?.receipt;
          // A local index cannot grant access to a path outside this account's directory.
          if (receipt && dirname(receipt.path) === directory && await realpath(receipt.path).catch(() => "") === receipt.path && await receiptExists(receipt)) {
            this.publish({ skipped: this.state.skipped + 1 }); return;
          }
          const saved = mediaType === "json"
            ? await downloadLocalFile({ response: await load(), directory, name, mediaType, signal: this.controller!.signal, onProgress: this.progress })
            : await resumeDownload({ request: headers => load(headers), directory, key, name, mediaType, signal: this.controller!.signal, onProgress: this.downloadProgress });
          items = items.filter(item => item.key !== key);
          items.push({ key, name, state: "saved", receipt: saved });
          this.publish({ completed: this.state.completed + 1 });
        } catch (error) {
          if (this.controller!.signal.aborted) throw error;
          const message = error instanceof Error ? error.message : "文件保存失败，请重试。";
          items = items.filter(item => item.key !== key); items.push({ key, name, state: "failed", error: message });
          this.publish({ failed: this.state.failed + 1 });
        }
        await checkpoint();
      };
      if (single) {
        await save(`asset:${single.assetId}`, String(single.name), headers => this.request(`/api/uploads/${single.assetId}/file`, credentials, headers, true), media, single.mediaType as "image" | "video");
      } else {
        for (let page = 1; page <= 1000; page++) {
          const list = await this.json(`/api/assets/history?page=${page}&pageSize=60`, credentials);
          if (!Array.isArray(list.data)) throw new Error("素材列表响应无效。");
          for (const asset of list.data as Asset[]) {
            if (!validId(asset.asset_object_id) || asset.retention_state === "soft_deleted" || asset.retention_state === "purged") continue;
            const mediaType = asset.mime_type?.startsWith("video/") ? "video" : "image";
            await save(`asset:${asset.asset_object_id}`, asset.title || `${mediaType}-${asset.asset_object_id.slice(0, 8)}`, headers => this.request(`/api/uploads/${asset.asset_object_id}/file`, credentials, headers, true), media, mediaType);
          }
          if (!(list.pagination as { hasMore?: boolean } | undefined)?.hasMore) break;
          if (page === 1000) throw new Error("单次保存已达到 60000 项上限，请分批保存剩余素材。");
        }
        const list = await this.json("/api/projects", credentials);
        if (!Array.isArray(list.projects)) throw new Error("项目列表响应无效。");
        for (const project of list.projects as Project[]) {
          if (!validId(project.id) || !validId(project.primaryCanvas?.id)) continue;
          this.publish({ current: project.name || "画布工程" });
          try {
            const canvas = await this.json(`/api/canvases/${project.primaryCanvas!.id}`, credentials);
            items = items.filter(item => item.key !== `project:${project.id}:failed`);
            const conversations = await this.json(`/api/canvases/${project.primaryCanvas!.id}/sessions`, credentials);
            if (!Array.isArray(conversations.sessions)) throw new Error("对话列表响应无效，未保存不完整的工程快照。");
            const sessions = [];
            for (const entry of conversations.sessions as Array<{ id: string; title?: string }>) {
              if (!validId(entry.id)) throw new Error("对话标识无效。");
              const history = await this.json(`/api/sessions/${entry.id}/messages`, credentials);
              if (!Array.isArray(history.messages)) throw new Error("对话记录响应无效。");
              sessions.push({ ...entry, messages: history.messages });
            }
            const content = JSON.stringify({ format: "helstera-project-backup", formatVersion: 1, project, canvas: canvas.canvas, canvasVersion: canvas.version, sessions });
            const revision = createHash("sha256").update(content).digest("hex").slice(0, 16);
            await save(`project:${project.id}:${revision}`, `${project.name || "project"}-${revision}`, async () => new Response(content, { headers: { "content-type": "application/json" } }), projects, "json");
          } catch (error) {
            if (this.controller.signal.aborted) throw error;
            items.push({ key: `project:${project.id}:failed`, name: project.name, state: "failed", error: error instanceof Error ? error.message : "项目保存失败" });
            this.publish({ failed: this.state.failed + 1 }); await checkpoint();
          }
        }
      }
      this.publish({ status: this.state.failed ? "partial" : "completed", current: "", bytes: 0, totalBytes: null });
      await checkpoint();
      return this.state;
    } catch (error) {
      this.publish({ status: this.controller.signal.aborted ? "canceled" : "failed", items, error: this.controller.signal.aborted ? "已暂停，已保存文件和可续传片段仍保留。" : error instanceof Error ? error.message : "保存失败，请重试。" });
      if (indexPath) await writeJsonAtomic(indexPath, this.state);
      return this.state;
    } finally { this.controller = undefined; }
  }
}
