import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceReceipt } from "./workspace-receipt.js";

export type BackupIndex = { account: string; items: Array<{ key: string; name?: string; receipt?: WorkspaceReceipt; [key: string]: unknown }>; [key: string]: unknown };
export function assertAccount(account: unknown): asserts account is string {
  if (typeof account !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(account)) throw new Error("本地账户标识无效。");
}
export async function readWorkspaceIndex(root: string, account: string): Promise<BackupIndex> {
  assertAccount(account);
  const path = join(root, "Projects", account, "backup-index.json");
  try {
    if (await realpath(path) !== path || (await stat(path)).size > 8 * 1024 ** 2) throw new Error("索引文件异常。");
    const index = JSON.parse(await readFile(path, "utf8"));
    if (index.account !== account || !Array.isArray(index.items) || index.items.some((item: { key?: unknown }) => !item || typeof item.key !== "string")) throw new Error("索引结构异常。");
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { account, items: [] };
    throw new Error("本地素材索引无法读取，请检查工作区文件。", { cause: error });
  }
}
