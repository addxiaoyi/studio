import { isAbsolute, relative, sep } from "node:path";
import { StorageState, storageKey } from "./storage-state.js";
import { assertAccount } from "./workspace-index.js";
import type { WorkspaceReceipt } from "./workspace-receipt.js";

export type RelinkChoice = { assetId: string; candidateId: string };
type Candidate = { id: string; name: string; relativePath: string; willCopy: boolean };
export type RelinkMatch = { assetId: string; name: string; bytes: number; status: "matched" | "ambiguous" | "missing" | "unchanged" | "invalid"; candidates: Candidate[] };
export type DirectoryPlan = { id: string; folder: string; items: RelinkMatch[]; warnings: string[]; truncated: boolean; savedAt: string; selections: RelinkChoice[] };
export type RelinkDraft = { plan: DirectoryPlan; root: string; account: string; paths: Map<string, string>; receipts: Map<string, WorkspaceReceipt>; expires: number };
const LIMIT = 25000;
const inside = (root: string, path: string) => { const tail = relative(root, path); return tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail); };
export function relinkChoices(plan: DirectoryPlan, input: unknown): RelinkChoice[] {
  if (!Array.isArray(input) || input.length > LIMIT) throw new Error("请逐项选择要关联的素材。");
  const seen = new Set<string>(), rows = new Map(plan.items.map(row => [row.assetId, row]));
  return input.map((entry: RelinkChoice | null) => {
    if (!entry || typeof entry.assetId !== "string" || typeof entry.candidateId !== "string") throw new Error("候选选择无效。");
    const row = rows.get(entry.assetId);
    if (!row || !["matched", "ambiguous"].includes(row.status) || !row.candidates.some(candidate => candidate.id === entry.candidateId) || seen.has(entry.assetId)) throw new Error("候选选择无效或重复。");
    seen.add(entry.assetId); return { assetId: entry.assetId, candidateId: entry.candidateId };
  });
}
export class RelinkDraftStore {
  private readonly store: StorageState;
  constructor(directory: string) { this.store = new StorageState(directory); }
  async save(draft: RelinkDraft) {
    await this.store.write(storageKey("relink", draft.root, draft.account), { version: 1, ...draft, paths: [...draft.paths], receipts: [...draft.receipts] });
  }
  async clear(root: string, account: string) { await this.store.clear(storageKey("relink", root, account)); }
  async read(root: string, account: string): Promise<RelinkDraft | null> {
    const value = await this.store.read(storageKey("relink", root, account));
    if (!value) return null;
    try {
      const saved = value as Omit<RelinkDraft, "paths" | "receipts"> & { version: number; paths: Array<[string, string]>; receipts: Array<[string, WorkspaceReceipt]> };
      if (saved.version !== 1 || saved.root !== root || saved.account !== account || !Number.isFinite(saved.expires) || !saved.plan || !isAbsolute(saved.plan.folder) || !Array.isArray(saved.paths) || !Array.isArray(saved.receipts) || saved.paths.length > LIMIT || saved.receipts.length > LIMIT) throw new Error("Invalid preview");
      const plan = saved.plan; assertAccount(plan.id);
      if (!Array.isArray(plan.items) || plan.items.length > LIMIT || !Array.isArray(plan.warnings) || plan.warnings.length > 30 || plan.warnings.some(warning => typeof warning !== "string") || !Number.isFinite(Date.parse(plan.savedAt)) || typeof plan.truncated !== "boolean") throw new Error("Invalid preview rows");
      const paths = new Map(saved.paths), receipts = new Map(saved.receipts);
      for (const [id, path] of paths) { assertAccount(id); if (typeof path !== "string" || !isAbsolute(path) || !inside(plan.folder, path)) throw new Error("Invalid candidate path"); }
      for (const [id, receipt] of receipts) { assertAccount(id); if (!receipt || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 || typeof receipt.path !== "string" || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error("Invalid receipt"); }
      const ids = new Set<string>();
      for (const row of plan.items) {
        assertAccount(row.assetId);
        if (ids.has(row.assetId) || typeof row.name !== "string" || !Number.isSafeInteger(row.bytes) || !["matched", "ambiguous", "missing", "unchanged", "invalid"].includes(row.status) || !Array.isArray(row.candidates) || row.candidates.length > 20) throw new Error("Invalid row");
        ids.add(row.assetId);
        for (const candidate of row.candidates) if (!paths.has(candidate.id) || typeof candidate.name !== "string" || typeof candidate.relativePath !== "string" || typeof candidate.willCopy !== "boolean") throw new Error("Invalid candidate");
      }
      relinkChoices(plan, plan.selections);
      if (saved.expires < Date.now()) { await this.clear(root, account); return null; }
      return { ...saved, paths, receipts };
    } catch (error) { throw new Error("保存的目录预览无法校验，请清除预览后重新选择目录；素材原文件保留。", { cause: error }); }
  }
}
