import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, realpath, rename, stat, statfs, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { DesktopSetup, writeJsonAtomic } from "./desktop-setup.js";
import { fileSha256 } from "./local-download.js";
import { assertAccount, readWorkspaceIndex } from "./workspace-index.js";
import { recordWorkspaceReceipt, type WorkspaceReceipt } from "./workspace-receipt.js";

type RelinkPlan = { id: string; assetId: string; filename: string; bytes: number; willCopy: boolean };
type Pending = { plan: RelinkPlan; root: string; account: string; chosen: string; receipt: WorkspaceReceipt; expires: number };
const inside = (root: string, path: string) => { const suffix = relative(root, path); return Boolean(suffix) && suffix !== ".." && !suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(suffix); };
const FORMAT = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|ogg)$/i;
const RESERVE = 512 * 1024 ** 2;
const extension = (path: string) => extname(path).toLowerCase().replace(".jpeg", ".jpg");

export class MediaRelink {
  private pending?: Pending;
  private running = false;
  constructor(private readonly setup: DesktopSetup) {}
  get busy() { return this.running; }
  async prepare(account: unknown, assetId: unknown, chosen: string): Promise<RelinkPlan> {
    assertAccount(account);
    assertAccount(assetId);
    if (this.running) throw new Error("正在关联素材，请稍候。");
    const setup = await this.setup.status();
    if (!setup.available || !setup.root) throw new Error("本地工作区不可用，请重新连接磁盘。");
    const index = await readWorkspaceIndex(setup.root, account), receipt = index.items.find(item => item.key === `asset:${assetId}`)?.receipt;
    if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0) throw new Error("缺少原文件校验记录，不能自动重新关联。");
    if (!isAbsolute(chosen) || !FORMAT.test(chosen) || await realpath(chosen) !== chosen) throw new Error("请选择真实的本地媒体文件，不要选择链接。");
    if (extension(chosen) !== extension(receipt.path)) throw new Error("所选文件格式与原素材不一致，请保留原媒体扩展名。");
    const info = await stat(chosen);
    if (!info.isFile() || info.size !== receipt.bytes || await fileSha256(chosen) !== receipt.sha256) throw new Error("所选文件与原素材内容不一致，未修改关联。");
    const accountFolder = join(setup.root, "Media", account);
    if (inside(join(setup.root, "Media"), chosen) && !inside(accountFolder, chosen)) throw new Error("不能关联其他账户目录中的素材。");
    const plan = { id: randomUUID(), assetId: String(assetId), filename: basename(chosen), bytes: receipt.bytes, willCopy: !inside(accountFolder, chosen) };
    this.pending = { plan, root: setup.root, account, chosen, receipt, expires: Date.now() + 5 * 60_000 };
    return plan;
  }
  async apply(id: unknown) {
    if (this.running) throw new Error("正在关联素材，请稍候。");
    const pending = this.pending; this.pending = undefined;
    if (!pending || pending.plan.id !== id || pending.expires < Date.now()) throw new Error("关联预览已失效，请重新选择文件。");
    this.running = true;
    let temporary: string | undefined;
    try {
      const setup = await this.setup.status();
      if (!setup.available || setup.root !== pending.root) throw new Error("工作区已改变，请重新选择。");
      const index = await readWorkspaceIndex(pending.root, pending.account), item = index.items.find(item => item.key === `asset:${pending.plan.assetId}`);
      if (!item?.receipt || JSON.stringify(item.receipt) !== JSON.stringify(pending.receipt)) throw new Error("素材索引已改变，请重新选择文件。");
      if (await realpath(pending.chosen) !== pending.chosen || (await stat(pending.chosen)).size !== pending.receipt.bytes || await fileSha256(pending.chosen) !== pending.receipt.sha256) throw new Error("所选文件已改变，未修改关联。");
      let target = pending.chosen;
      if (pending.plan.willCopy) {
        const folder = join(pending.root, "Media", pending.account, "Relinked"); await mkdir(folder, { recursive: true });
        if (await realpath(folder) !== folder) throw new Error("素材目录不能是链接。");
        const space = await statfs(folder);
        if (space.bavail * space.bsize < pending.receipt.bytes + RESERVE) throw new Error("本地磁盘空间不足，无法复制所选原文件。");
        target = join(folder, `${pending.plan.assetId}-${pending.receipt.sha256.slice(0, 12)}${extname(pending.chosen).toLowerCase()}`);
        temporary = join(folder, `.${randomUUID()}.part`);
        await copyFile(pending.chosen, temporary, constants.COPYFILE_EXCL);
        if ((await stat(temporary)).size !== pending.receipt.bytes || await fileSha256(temporary) !== pending.receipt.sha256) throw new Error("复制过程中原文件已改变，未更新关联。");
        await rename(temporary, target); temporary = undefined;
      }
      item.receipt = recordWorkspaceReceipt(pending.root, { ...pending.receipt, path: target });
      item.state = "saved"; delete item.error;
      await writeJsonAtomic(join(pending.root, "Projects", pending.account, "backup-index.json"), index);
      return { filename: basename(target), copied: pending.plan.willCopy, bytes: pending.receipt.bytes };
    } finally {
      this.running = false;
      if (temporary) await unlink(temporary).catch(error => { if (error.code !== "ENOENT") console.error("[media-relink] Temporary copy cleanup failed", error); });
    }
  }
}
