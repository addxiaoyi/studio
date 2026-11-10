import { z } from "zod";
import { canvasContentSchema, chatMessageSchema } from "./contracts.js";

export const projectBackupSchema = z.object({
  format: z.literal("helstera-project-backup"),
  formatVersion: z.literal(1).optional(),
  version: z.number().int().positive().optional(),
  project: z.object({ id: z.string().uuid(), name: z.string().min(1).max(200), workspace: z.object({ ownerUserId: z.string().uuid().optional() }).passthrough().optional() }).passthrough(),
  canvas: z.object({ id: z.string().uuid(), name: z.string().max(200).optional(), content: canvasContentSchema }),
  sessions: z.array(z.object({ id: z.string().uuid(), title: z.string().max(300).optional(), messages: z.array(chatMessageSchema).max(5000) })).max(100),
  canvasVersion: z.number().int().positive().optional(),
}).refine(value => value.canvas.content.elements.length <= 20000, "Too many canvas elements");
export type ProjectBackup = z.infer<typeof projectBackupSchema>;
const ASSET_URL = /(?:https?:\/\/[^\s"<>]+)?\/api\/uploads\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/file(?:\?[^\s"<>]*)?/gi;

export function backupAssetIds(value: unknown): string[] {
  const ids = new Set<string>();
  function visit(value: unknown, depth: number) {
    if (depth > 80) throw new Error("快照层级过深。");
    if (typeof value === "string") for (const match of value.matchAll(ASSET_URL)) ids.add(match[1]!.toLowerCase());
    else if (Array.isArray(value)) value.forEach(child => visit(child, depth + 1));
    else if (value && typeof value === "object") Object.values(value).forEach(child => visit(child, depth + 1));
  }
  visit(value, 0); return [...ids];
}
export function replaceBackupAssets<T>(value: T, replacements: Record<string, string>): T {
  function visit(value: unknown, key = ""): unknown {
    if (typeof value === "string") {
      if (["assetId", "assetObjectId"].includes(key) && replacements[value.toLowerCase()]) return replacements[value.toLowerCase()];
      return value.replace(ASSET_URL, (url, id: string) => replacements[id.toLowerCase()] ? `/api/uploads/${replacements[id.toLowerCase()]}/file` : url);
    }
    if (Array.isArray(value)) return value.map(child => visit(child));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, key)]));
    return value;
  }
  return visit(value) as T;
}

export const restoreBackupRequestSchema = z.object({ snapshot: projectBackupSchema, replacements: z.record(z.string().uuid(), z.string().uuid()).default({}) });
export type BackupRestoreResult = { projectId: string; canvasId: string; sessionId: string | null; restored: boolean };
