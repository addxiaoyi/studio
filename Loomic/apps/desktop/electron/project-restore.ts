import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { backupAssetIds, projectBackupSchema, type ProjectBackup, type BackupRestoreResult } from "@helstera/shared";
import { DesktopSetup } from "./desktop-setup.js";
import { receiptExists, type LocalReceipt } from "./local-download.js";

export type RestorePreview = { id: string; name: string; elements: number; sessions: number; messages: number; localMedia: number; uploadBytes: number; missingMedia: number; fileName: string };
type Credentials = { accessToken: string; accountId: string };
type LocalMedia = { assetId: string; receipt: LocalReceipt; mime: string };
type PendingRestore = { preview: RestorePreview; snapshot: ProjectBackup; sha256: string; path: string; accountId: string; media: LocalMedia[]; expires: number; result?: BackupRestoreResult };
type RestoreOptions = { setup: DesktopSetup; origin: () => string; request: typeof fetch };
const MAX_SNAPSHOT = 16 * 1024 * 1024;
const mimeTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm" };

export class ProjectRestore {
  private pending: PendingRestore | null = null;
  private running = false;
  constructor(private readonly options: RestoreOptions) {}
  get busy() { return this.running; }
  private credentials(input: unknown): Credentials {
    const value = input as Credentials | null;
    if (!value || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.accountId) || typeof value.accessToken !== "string" || !value.accessToken || value.accessToken.length > 16384) throw new Error("请先登录恢复目标账户。");
    return value;
  }
  private async request(path: string, credentials: Credentials, options: RequestInit = {}) {
    return this.options.request(new URL(path, this.options.origin()), { ...options, headers: { Authorization: `Bearer ${credentials.accessToken}`, ...options.headers }, credentials: "include", redirect: "error", signal: AbortSignal.timeout(180000) });
  }
  private async identity(credentials: Credentials) {
    const response = await this.request("/api/viewer", credentials);
    if (!response.ok || (await response.json() as { profile?: { id?: string } }).profile?.id !== credentials.accountId) throw new Error("登录身份已改变，请重新选择快照。");
  }
  async inspect(path: string, input: unknown): Promise<RestorePreview> {
    if (this.busy) throw new Error("恢复任务正在执行。");
    this.pending = null;
    const credentials = this.credentials(input);
    await this.identity(credentials);
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (!info.isFile() || info.size > MAX_SNAPSHOT || !info.size) throw new Error("请选择不超过 16 MiB 的工程 JSON 快照。");
    const bytes = await readFile(canonical);
    const parsed = projectBackupSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) throw new Error("工程快照格式不正确，请选择 Projects 中的快照文件。");
    const snapshot = parsed.data;
    if (snapshot.project.workspace?.ownerUserId && snapshot.project.workspace.ownerUserId !== credentials.accountId) throw new Error("请登录创建此快照的账户后恢复。");
    const setup = await this.options.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用，请重新选择。");
    const mediaRoot = join(setup.root, "Media", credentials.accountId);
    let receipts: Array<{ key: string; receipt?: LocalReceipt }> = [];
    try { const index = JSON.parse(await readFile(join(setup.root, "Projects", credentials.accountId, "backup-index.json"), "utf8")); if (index.account === credentials.accountId && Array.isArray(index.items)) receipts = index.items; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("本地素材索引无法读取。"); }
    const media: LocalMedia[] = []; let missing = 0;
    for (const assetId of backupAssetIds(snapshot)) {
      const receipt = receipts.find(item => item.key === `asset:${assetId}`)?.receipt;
      const mime = receipt ? mimeTypes[extname(receipt.path).toLowerCase()] : undefined;
      if (receipt && mime && dirname(receipt.path) === mediaRoot && await realpath(receipt.path).catch(() => "") === receipt.path && await receiptExists(receipt)) {
        if (receipt.bytes > (mime.startsWith("video/") ? 250 : 25) * 1024 ** 2) throw new Error("快照素材超过单次恢复上传上限（视频 250 MiB，图片 25 MiB）。");
        media.push({ assetId, receipt, mime });
      } else {
        const live = await this.request(`/api/uploads/${assetId}/file`, credentials, { method: "HEAD" });
        if (!live.ok) missing++;
      }
    }
    const preview: RestorePreview = { id: randomUUID(), name: snapshot.project.name, elements: snapshot.canvas.content.elements.length, sessions: snapshot.sessions.length,
      messages: snapshot.sessions.reduce((sum, session) => sum + session.messages.length, 0), localMedia: media.length, uploadBytes: media.reduce((sum, item) => sum + item.receipt.bytes, 0), missingMedia: missing, fileName: canonical.split(/[\\/]/).pop()! };
    this.pending = { preview, snapshot, media, path: canonical, accountId: credentials.accountId, sha256: createHash("sha256").update(bytes).digest("hex"), expires: Date.now() + 30 * 60_000 };
    return preview;
  }
  async apply(id: unknown, input: unknown): Promise<BackupRestoreResult> {
    if (this.busy) throw new Error("恢复任务正在执行，请勿重复提交。");
    const credentials = this.credentials(input), pending = this.pending;
    if (!pending || pending.preview.id !== id || pending.expires < Date.now() || pending.accountId !== credentials.accountId) throw new Error("快照预览已失效，请重新选择。");
    if (pending.preview.missingMedia) throw new Error("存在无法恢复的素材，请先补齐本地副本。");
    this.running = true;
    try {
      await this.identity(credentials);
      if (pending.result) return pending.result;
      if (await realpath(pending.path) !== pending.path || (await stat(pending.path)).size > MAX_SNAPSHOT || createHash("sha256").update(await readFile(pending.path)).digest("hex") !== pending.sha256) throw new Error("快照文件已改变，请重新预览。");
      const replacements: Record<string, string> = {};
      for (const item of pending.media) {
        if (await realpath(item.receipt.path) !== item.receipt.path || !await receiptExists(item.receipt)) throw new Error("本地素材已改变，请重新预览。");
        const hash = createHash("sha256").update(`${credentials.accountId}:${pending.sha256}:${item.assetId}`).digest("hex");
        const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const form = new FormData(); form.append("file", await openAsBlob(item.receipt.path, { type: item.mime }), `restore${extname(item.receipt.path)}`);
        const response = await this.request(`/api/assets/${item.mime.startsWith("video/") ? "private-video" : "private-try-on"}`, credentials, { method: "POST", headers: { "Idempotency-Key": key }, body: form });
        if (!response.ok) throw new Error(`素材恢复上传失败（${response.status}）。已上传素材可在重试时复用。`);
        const body = await response.json() as { assetId?: string };
        if (!body.assetId) throw new Error("素材上传回执缺少标识。");
        replacements[item.assetId] = body.assetId;
      }
      const response = await this.request("/api/project-backups/restore", credentials, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshot: pending.snapshot, replacements }) });
      const body = await response.json() as { ok: boolean; data?: BackupRestoreResult; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message ?? "工程恢复失败，请重试。");
      pending.result = body.data; return body.data;
    } finally { this.running = false; }
  }
}
