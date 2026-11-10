import { realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { receiptExists, type LocalReceipt } from "./local-download.js";

export type WorkspaceReceipt = LocalReceipt & { relativePath?: string };
export function recordWorkspaceReceipt(root: string, receipt: LocalReceipt): WorkspaceReceipt {
  return { ...receipt, relativePath: relative(root, receipt.path).replaceAll("\\", "/") };
}

/** Only rebase within the selected account; never fall back to a stale drive. */
export async function resolveWorkspaceReceipt(root: string, kind: "Media" | "Projects", account: string, receipt: WorkspaceReceipt | undefined): Promise<WorkspaceReceipt | null> {
  if (!receipt || typeof receipt.path !== "string" || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(receipt.sha256)) return null;
  const segments = (receipt.relativePath ?? receipt.path.replaceAll("\\", "/").split("/").slice(-3).join("/")).split("/");
  if (segments.length !== 3 || segments[0] !== kind || segments[1] !== account || !segments[2] || /[\\/:\x00-\x1f]/.test(segments[2]) || [".", ".."].includes(segments[2])) return null;
  const path = join(root, ...segments), rebased = { ...receipt, path, relativePath: segments.join("/") };
  try { return await realpath(path) === path && await receiptExists(rebased) ? rebased : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
