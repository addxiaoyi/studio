import { realpath, stat, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";
import { mediaFileVersion } from "./media-file-version.js";

const proofSchema = z.object({ bytes: z.number().int().positive().max(2 * 1024 ** 3), sha256: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal("release-cloud-copy") });
type Proof = z.infer<typeof proofSchema>;
class ReleaseError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function releaseCopy(db: Pool, root: string, actor: string, assetId: string, proof: Proof) {
  const client = await db.connect();
  let locked = false, marked = false;
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1,0))", [`release-cloud-copy:${assetId}`]); locked = true;
    await client.query("begin");
    const asset = (await client.query<{ workspace_id: string; bucket: string; object_path: string; mime_type: string }>(`select ao.workspace_id,ao.bucket,ao.object_path,ao.mime_type from asset_objects ao
      where ao.id=$1 and ao.created_by=$2 and exists(select 1 from workspace_members wm where wm.workspace_id=ao.workspace_id and wm.user_id=$2) for update`, [assetId, actor])).rows[0];
    if (!asset) {
      const previous = await client.query("select id from notifications where user_id=$1 and type='asset_cloud_released' and metadata->>'assetId'=$2 and metadata->>'sha256'=$3 and metadata->>'bytes'=$4 limit 1", [actor, assetId, proof.sha256, String(proof.bytes)]);
      const cleaned = previous.rows.length ? previous : await client.query(`select ga.id from generated_assets ga where ga.created_by=$1 and ga.retention_state='purged'
        and ga.metadata->'localCopyRelease'->>'assetId'=$2 and ga.metadata->'localCopyRelease'->>'sha256'=$3 and ga.metadata->'localCopyRelease'->>'bytes'=$4
        and exists(select 1 from workspace_members wm where wm.workspace_id=ga.workspace_id and wm.user_id=$1) limit 1`, [actor, assetId, proof.sha256, String(proof.bytes)]);
      await client.query("rollback");
      if (cleaned.rows.length) return { state: "released" as const, bytes: proof.bytes };
      throw new ReleaseError("素材不存在或不属于当前账户。", 404);
    }
    if (!/^(image|video)\//.test(asset.mime_type)) throw new ReleaseError("此素材类型暂不支持释放云端副本。", 400);
    const base = await realpath(root), path = resolve(base, asset.bucket, asset.object_path), inside = relative(base, path);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new ReleaseError("素材路径无效。", 409);
    const metadata = (await client.query<{ metadata: { localCopyRelease?: { sha256: string; bytes: number } } }>("select metadata from generated_assets where workspace_id=$1 and object_path=$2 for update", [asset.workspace_id, asset.object_path])).rows;
    const pending = metadata.some(row => row.metadata?.localCopyRelease?.sha256 === proof.sha256 && row.metadata.localCopyRelease.bytes === proof.bytes);
    try {
      if (await realpath(path) !== path || (await stat(path)).size !== proof.bytes || await mediaFileVersion(path) !== `"${proof.sha256}"`) throw new ReleaseError("云端文件与本地校验记录不一致，未释放素材。", 409);
    } catch (error) { if (!(pending && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error; }
    const receipt = JSON.stringify({ assetId, sha256: proof.sha256, bytes: proof.bytes });
    if (!metadata.length) {
      await client.query(`insert into generated_assets(workspace_id,created_by,media_type,object_path,mime_type,title) values($1,$2,$3,$4,$5,'本地副本已保存')`, [asset.workspace_id, actor, asset.mime_type.startsWith("video/") ? "video" : "image", asset.object_path, asset.mime_type]);
    }
    // Persist the cleanup request before removing bytes; the retention worker can finish after a crash.
    await client.query(`update generated_assets set deleted_at=now(),retention_state='soft_deleted',purge_after=now(),updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('localCopyRelease',$3::jsonb) where workspace_id=$1 and object_path=$2`, [asset.workspace_id, asset.object_path, receipt]);
    await client.query("commit"); marked = true;
    await client.query("begin");
    await client.query("select id from asset_objects where id=$1 for update", [assetId]);
    await client.query("select id from generated_assets where workspace_id=$1 and object_path=$2 for update", [asset.workspace_id, asset.object_path]);
    await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
    await client.query("update gallery_items set status='removed',deleted_at=now(),updated_at=now() where workspace_id=$1 and asset_id in(select id from generated_assets where workspace_id=$1 and object_path=$2)", [asset.workspace_id, asset.object_path]);
    await client.query("update generated_assets set retention_state='purged',updated_at=now() where workspace_id=$1 and object_path=$2", [asset.workspace_id, asset.object_path]);
    await client.query("delete from asset_objects where id=$1", [assetId]);
    await client.query("insert into notifications(workspace_id,user_id,type,title,body,metadata) values($1,$2,'asset_cloud_released','云端副本已释放','本地原文件保留。其他设备需要重新上传本地素材后才能使用。',$3::jsonb)", [asset.workspace_id, actor, receipt]);
    await client.query("commit");
    return { state: "released" as const, bytes: proof.bytes };
  } catch (error) {
    await client.query("rollback");
    if (!marked) throw error;
    console.error("[local-copy-release] Cleanup pending", assetId, error);
    return { state: "pending" as const, bytes: 0 };
  } finally {
    try { if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [`release-cloud-copy:${assetId}`]); }
    finally { client.release(); }
  }
}

export function registerLocalCopyRelease(app: FastifyInstance, options: { db: Pool; root: string; auth: RequestAuthenticator }) {
  app.post<{ Params: { assetId: string } }>("/api/uploads/:assetId/release-local-copy", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录。" } });
    const proof = proofSchema.safeParse(request.body), id = z.string().uuid().safeParse(request.params.assetId);
    if (!proof.success || !id.success) return reply.code(400).send({ ok: false, error: { code: "invalid_proof", message: "请重新校验本地文件并确认释放影响。" } });
    try { return { ok: true, data: await releaseCopy(options.db, options.root, user.id, id.data, proof.data) }; }
    catch (error) {
      request.log.error({ err: error }, "local copy release failed");
      return reply.code(error instanceof ReleaseError ? error.status : 500).send({ ok: false, error: { code: "release_failed", message: error instanceof ReleaseError ? error.message : "云端释放失败，请保留本地文件后重试。" } });
    }
  });
}
