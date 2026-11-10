import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./desktop-setup.js";

export const storageKey = (kind: string, root: string, account: string) => `${kind}-${createHash("sha256").update(`${root}\0${account}`).digest("hex")}`;
export class StorageState {
  constructor(private readonly directory: string) {}
  private async path(key: string) {
    if (!/^[a-z0-9-]{1,100}$/.test(key)) throw new Error("本地记录名称无效。");
    await mkdir(this.directory, { recursive: true });
    if (await realpath(this.directory) !== this.directory) throw new Error("本地配置目录不能是链接。");
    return join(this.directory, `${key}.json`);
  }
  async read(key: string): Promise<unknown | null> {
    const path = await this.path(key);
    try {
      if (await realpath(path) !== path || (await stat(path)).size > 32 * 1024 ** 2) throw new Error("本地记录大小或位置异常。");
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("本地任务记录无法读取，请清除对应预览或进度后重试。", { cause: error }); }
  }
  async write(key: string, value: unknown) { await writeJsonAtomic(await this.path(key), value); }
  async clear(key: string) { await unlink(await this.path(key)).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
