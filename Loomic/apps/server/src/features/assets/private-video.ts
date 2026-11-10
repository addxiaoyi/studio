import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Pool } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";

export class PrivateVideoConflict extends Error {}

type PrivateVideoInput = {
  workspaceId: string;
  userId: string;
  uploadId: string;
  bytes: Buffer;
  mimeType: "video/mp4" | "video/webm";
  filename?:string;
};

export async function savePrivateVideo(db: Pool, storage: StorageProvider, input: PrivateVideoInput) {
  return savePrivateMedia(db, storage, input, "video");
}

type PrivateVideoFile = Omit<PrivateVideoInput, "bytes"> & { path: string; bytes: number; sha256: string };
export async function savePrivateVideoFile(db: Pool, storage: StorageProvider, input: PrivateVideoFile) {
  if (!storage.uploadFile) throw new Error("Storage does not support file uploads.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(input.path)) hash.update(chunk);
  if (hash.digest("hex") !== input.sha256 || (await stat(input.path)).size !== input.bytes) throw new PrivateVideoConflict("上传文件校验失败，请重新上传。");
  return savePrivateMedia(db, storage, input, "video");
}

type PrivateImageInput = Omit<PrivateVideoInput, "mimeType"> & { mimeType: "image/png" | "image/jpeg" | "image/webp" };
export async function savePrivateImage(db: Pool, storage: StorageProvider, input: PrivateImageInput) {
  return savePrivateMedia(db, storage, input, "image");
}

async function savePrivateMedia(db: Pool, storage: StorageProvider, input: PrivateVideoInput | PrivateImageInput | PrivateVideoFile, mediaType: "image" | "video") {
  const bucket = mediaType === "video" ? "private-video" : "private-try-on";
  const uploadKey = mediaType === "video" ? "videoExportUploadId" : "tryOnUploadId";
  const digest = "path" in input ? input.sha256 : createHash("sha256").update(input.bytes).digest("hex");
  const title=mediaType==="video"?input.filename?.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,160)||"Video export":"试穿结果";
  const client = await db.connect();
  let uploaded = false;
  let commitStarted = false;
  const objectId = randomUUID();
  const extension = input.mimeType.split("/")[1];
  const objectPath = `${input.workspaceId}/generated/${bucket}/${randomUUID()}.${extension}`;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${bucket}:${input.workspaceId}:${input.userId}:${input.uploadId}`]);
    const previous = await client.query<{ id: string | null; digest: string; mime_type: string; active: boolean }>(
      `select ao.id, ga.metadata->>'sha256' as digest, ga.mime_type,
              (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until > now()) as active
       from generated_assets ga left join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path
       where ga.workspace_id=$1 and ga.created_by=$2 and ga.metadata->>$4::text=$3
       limit 1`,
      [input.workspaceId, input.userId, input.uploadId, uploadKey],
    );
    if (previous.rows[0]) {
      const item = previous.rows[0];
      if (!item.id || !item.active || item.digest !== digest || item.mime_type !== input.mimeType) {
        throw new PrivateVideoConflict("The upload identifier is already in use or its cloud copy has expired.");
      }
      if(mediaType==="video"&&input.filename)await client.query("update generated_assets set title=$5 where workspace_id=$1 and created_by=$2 and metadata->>$4::text=$3 and title='Video export'",[input.workspaceId,input.userId,input.uploadId,uploadKey,title]);
      commitStarted = true;
      await client.query("commit");
      return { assetId: item.id, created: false };
    }
    const stored = "path" in input ? await storage.uploadFile!(bucket, objectPath, input.path) : await storage.upload(bucket, objectPath, input.bytes, { contentType: input.mimeType, upsert: false });
    if (stored.error) throw new Error("Could not save the private video.", { cause: stored.error });
    uploaded = true;
    await client.query(
      `insert into asset_objects(id,workspace_id,bucket,object_path,mime_type,byte_size,created_by)
       values($1,$2,$7,$3,$4,$5,$6)`,
      [objectId, input.workspaceId, objectPath, input.mimeType, typeof input.bytes === "number" ? input.bytes : input.bytes.length, input.userId, bucket],
    );
    await client.query(
      `insert into generated_assets(workspace_id,created_by,media_type,object_path,mime_type,title,metadata,retention_until)
       values($1,$2,$6,$3,$4,$7,$5::jsonb,now() + interval '3 days')`,
      [input.workspaceId, input.userId, objectPath, input.mimeType, JSON.stringify({ [uploadKey]: input.uploadId, sha256: digest }), mediaType, title],
    );
    commitStarted = true;
    await client.query("commit");
    return { assetId: objectId, created: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (uploaded && !commitStarted) {
      const removed = await storage.remove(bucket, [objectPath]);
      if (removed.error) console.error("[private-video] Failed to remove uncommitted object", removed.error);
    }
    throw error;
  } finally {
    client.release();
  }
}
