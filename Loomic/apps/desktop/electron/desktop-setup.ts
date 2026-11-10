import { mkdir, readFile, realpath, rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { verifyAssetFolder } from "./asset-folder.js";

export type SetupConfig = { version: 1; completed: boolean; root: string | null; autoBackup: boolean; agentAccess: boolean };
export type SetupState = SetupConfig & { available: boolean; availableBytes?: number; error?: string };
const defaults: SetupConfig = { version: 1, completed: false, root: null, autoBackup: false, agentAccess: false };

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(cleanup => { if (cleanup.code !== "ENOENT") console.warn("[desktop-setup] Could not remove temporary settings file."); });
    throw error;
  }
}

export class DesktopSetup {
  private chosen: string | null = null;
  constructor(private readonly profile: string) {}
  async status(): Promise<SetupState> {
    let config: SetupConfig;
    try {
      config = JSON.parse(await readFile(join(this.profile, "desktop-setup.json"), "utf8"));
      if (config.version !== 1 || typeof config.completed !== "boolean" || typeof config.root !== "string" || !isAbsolute(config.root)
        || typeof config.autoBackup !== "boolean" || typeof config.agentAccess !== "boolean") throw new Error("Invalid setup");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults, available: false };
      return { ...defaults, available: false, error: "本地配置无法读取，请重新选择工作区。已有文件不会被删除。" };
    }
    try { return { ...config, available: true, availableBytes: (await verifyAssetFolder(config.root!)).availableBytes }; }
    catch { return { ...config, available: false, error: "工作区已移动、磁盘未连接或没有写入权限，请重新选择。" }; }
  }
  async choose(path: string) {
    if (!isAbsolute(path)) throw new Error("请选择本机文件夹。");
    const root = await realpath(path);
    const folder = await verifyAssetFolder(root);
    this.chosen = root;
    return { root, availableBytes: folder.availableBytes };
  }
  async complete(input: unknown): Promise<SetupState> {
    const value = input as Partial<SetupConfig> | null;
    if (!value || typeof value.autoBackup !== "boolean" || typeof value.agentAccess !== "boolean") throw new Error("初始化选项无效。");
    const previous = await this.status();
    const root = this.chosen ?? previous.root;
    if (!root) throw new Error("请先选择本地工作区。");
    await verifyAssetFolder(root);
    for (const name of ["Media", "Projects", "Exports"]) {
      await mkdir(join(root, name), { recursive: true });
      // A pre-existing folder must not redirect writes outside the selected workspace.
      if (await realpath(join(root, name)) !== join(root, name)) throw new Error(`${name} 目录不能是链接，请选择其他工作区。`);
    }
    await mkdir(this.profile, { recursive: true });
    await writeJsonAtomic(join(this.profile, "asset-storage.json"), { directory: join(root, "Media") });
    await writeJsonAtomic(join(this.profile, "desktop-setup.json"), { version: 1, completed: true, root, autoBackup: value.autoBackup, agentAccess: value.agentAccess });
    this.chosen = null;
    return this.status();
  }
}
