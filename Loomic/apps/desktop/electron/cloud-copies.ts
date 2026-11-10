import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { DesktopSetup, writeJsonAtomic } from "./desktop-setup.js";
import { readWorkspaceIndex } from "./workspace-index.js";
import { resolveWorkspaceReceipt, workspaceReceiptPath, type WorkspaceReceipt } from "./workspace-receipt.js";

type Credentials = { accountId: string; accessToken: string };
type Options = { setup: DesktopSetup; identity: (input: unknown) => Promise<string>; origin: () => string; request: typeof fetch };
type ReleasePlan = { id: string; name: string; assetId: string; bytes: number; filename: string };
type PendingRelease = { plan: ReleasePlan; root: string; account: string; receipt: WorkspaceReceipt; expires: number };

export class CloudCopies {
  private pending?: PendingRelease;
  private running = false;
  constructor(private readonly options: Options) {}
  get busy() { return this.running; }
  private async root() {
    const setup = await this.options.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用，请先连接保存原文件的磁盘。");
    return setup.root;
  }
  private request(path: string, credentials: Credentials, options: RequestInit = {}) {
    return this.options.request(new URL(path, this.options.origin()), { ...options, credentials: "include", redirect: "error", headers: { Authorization: `Bearer ${credentials.accessToken}`, ...options.headers }, signal: AbortSignal.timeout(180000) });
  }
  async list(input: unknown) {
    const account = await this.options.identity(input), root = await this.root();
    const index = await readWorkspaceIndex(root, account), copies = [];
    for (const item of index.items) {
      if (!/^asset:[a-f\d-]{36}$/i.test(item.key)) continue;
      const path = workspaceReceiptPath(root, "Media", account, item.receipt);
      if (!path) continue;
      try {
        const info = await stat(path);
        if (!info.isFile() || await realpath(path) !== path || info.size !== item.receipt?.bytes) continue;
        copies.push({ assetId: item.key.slice(6), name: item.name || basename(path), bytes: info.size, cloudState: item.cloudState === "released" || item.cloudState === "pending" ? item.cloudState : "unknown" });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return copies;
  }
  async prepare(assetId: unknown, input: unknown): Promise<ReleasePlan> {
    if (this.busy) throw new Error("云端释放正在处理。");
    const account = await this.options.identity(input), root = await this.root();
    const index = await readWorkspaceIndex(root, account), item = index.items.find(item => item.key === `asset:${assetId}`);
    const receipt = await resolveWorkspaceReceipt(root, "Media", account, item?.receipt);
    if (!item || !receipt) throw new Error("本地原文件缺失或校验失败，不能释放云端副本。");
    const response = await this.request(`/api/uploads/${assetId}/file`, input as Credentials, { method: "HEAD" });
    if (response.ok && (response.headers.get("etag") !== `"${receipt.sha256}"` || Number(response.headers.get("content-length")) !== receipt.bytes)) throw new Error("本地文件与当前云端版本不一致，不能释放。");
    if (!response.ok && !(response.status === 404 && receipt.restoreEpoch)) throw new Error(`无法核对云端文件（${response.status}），本地原文件保留。`);
    const plan = { id: randomUUID(), assetId: String(assetId), name: item.name || basename(receipt.path), bytes: receipt.bytes, filename: basename(receipt.path) };
    this.pending = { plan, root, account, receipt, expires: Date.now() + 5 * 60_000 };
    return plan;
  }
  async apply(id: unknown, input: unknown) {
    if (this.busy) throw new Error("云端释放正在处理。");
    const pending = this.pending; this.pending = undefined;
    if (!pending || pending.plan.id !== id || pending.expires < Date.now()) throw new Error("释放预览已失效，请重新校验。");
    this.running = true;
    try {
      const account = await this.options.identity(input), root = await this.root();
      if (account !== pending.account || root !== pending.root) throw new Error("账户或工作区已改变，请重新校验。");
      const index = await readWorkspaceIndex(root, account), item = index.items.find(item => item.key === `asset:${pending.plan.assetId}`);
      const receipt = await resolveWorkspaceReceipt(root, "Media", account, item?.receipt);
      if (!item || !receipt || receipt.sha256 !== pending.receipt.sha256 || receipt.bytes !== pending.receipt.bytes) throw new Error("本地文件已改变，未释放云端副本。");
      // A later explicit restore must use a new upload identity, even after an interrupted release.
      item.receipt = { ...receipt, restoreEpoch: randomUUID() };
      item.cloudState = "pending";
      await writeJsonAtomic(join(root, "Projects", account, "backup-index.json"), index);
      const response = await this.request(`/api/uploads/${pending.plan.assetId}/release-local-copy`, input as Credentials, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bytes: receipt.bytes, sha256: receipt.sha256, confirmation: "release-cloud-copy" }) });
      const body = await response.json() as { ok?: boolean; data?: { state: "released" | "pending"; bytes: number }; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data || !["released", "pending"].includes(body.data.state)) throw new Error(body.error?.message || "释放未完成，请重试；本地文件保留。");
      item.cloudState = body.data.state;
      await writeJsonAtomic(join(root, "Projects", account, "backup-index.json"), index);
      return body.data;
    } finally { this.running = false; }
  }
}
