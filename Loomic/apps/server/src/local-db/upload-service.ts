import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AssetBucket, AssetObject } from "@helstera/shared";
import type { AuthenticatedUser } from "../supabase/user.js";
import { UploadServiceError, type UploadFileInput, type UploadService } from "../features/uploads/upload-service.js";

export function createLocalUploadService(db: Pool, root = "/www/helstera/uploads"): UploadService {
  return {
    async uploadFile(user, input) {
      const path = `${input.workspaceId}/${input.projectId ?? "workspace"}/${randomUUID()}-${safeName(input.fileName)}`;
      const absolute = join(root, path);
      await mkdir(join(root, input.workspaceId, input.projectId ?? "workspace"), { recursive: true });
      await writeFile(absolute, input.fileBuffer, { flag: "wx" });
      try {
        const { rows } = await db.query(`insert into asset_objects (workspace_id, project_id, bucket, object_path, mime_type, byte_size, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id, bucket, object_path, mime_type, byte_size, workspace_id, project_id, created_at`, [input.workspaceId, input.projectId ?? null, input.bucket, path, input.mimeType, input.fileBuffer.length, user.id]);
        return { asset: mapAsset(rows[0]), url: `/api/uploads/${rows[0].id}/file` };
      } catch (error) {
        await unlink(absolute).catch(() => undefined);
        throw new UploadServiceError("upload_failed", "Failed to record asset metadata.", 500);
      }
    },
    async getAssetUrl(user, assetId) {
      const row = await findAsset(db, user.id, assetId);
      return `/api/uploads/${row.id}/file`;
    },
    async deleteAsset(user, assetId) {
      const row = await findAsset(db, user.id, assetId);
      await unlink(join(root, row.object_path)).catch(() => undefined);
      await db.query("delete from asset_objects where id = $1", [row.id]);
    },
  };
}

async function findAsset(db: Pool, userId: string, assetId: string) {
  const { rows } = await db.query("select ao.id, ao.object_path, ao.bucket from asset_objects ao join workspace_members wm on wm.workspace_id = ao.workspace_id where ao.id = $1 and wm.user_id = $2", [assetId, userId]);
  if (!rows[0]) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
  return rows[0];
}

function mapAsset(row: any): AssetObject { return { id: row.id, bucket: row.bucket as AssetBucket, objectPath: row.object_path, mimeType: row.mime_type, byteSize: row.byte_size, workspaceId: row.workspace_id, projectId: row.project_id, createdAt: row.created_at.toISOString() }; }
function safeName(name: string) { return name.replace(/[^a-zA-Z0-9._-]/g, "_"); }
