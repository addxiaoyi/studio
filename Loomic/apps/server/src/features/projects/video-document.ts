import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { projectVideoRevisionSchema, type ProjectVideoWrite } from "@helstera/shared";
import { ProjectContextError } from "./project-context.js";

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const RETAINED_VERSIONS = 20;
type Database = Pick<Pool,"query">;

async function authorizeProject(db: Database, userId: string, projectId: string, lock = false): Promise<string> {
  const {rows}=await db.query(`select p.workspace_id from projects p join workspaces w on w.id=p.workspace_id
    where p.id=$1 and w.owner_user_id=$2 and p.archived_at is null ${lock ? "for share of p,w" : ""}`, [projectId,userId]);
  if (!rows[0]) throw new ProjectContextError(404,"project_unavailable","工程不存在、已归档，或当前账号无权访问。");
  return rows[0].workspace_id;
}

export async function readVideoDocument(db: Database, userId: string, projectId: string, revision?: number) {
  await authorizeProject(db,userId,projectId);
  const {rows}=revision===undefined
    ? await db.query("select revision,document,sync_enabled,updated_at from project_video_documents where project_id=$1",[projectId])
    : await db.query("select revision,document,sync_enabled,created_at as updated_at from project_video_versions where project_id=$1 and revision=$2",[projectId,revision]);
  if (!rows[0]) return null;
  return projectVideoRevisionSchema.parse({revision:rows[0].revision,document:rows[0].document,syncEnabled:rows[0].sync_enabled,updatedAt:new Date(rows[0].updated_at).toISOString()});
}

export async function listVideoVersions(db: Database, userId: string, projectId: string) {
  await authorizeProject(db,userId,projectId);
  const {rows}=await db.query("select revision,created_at,octet_length(document::text) as bytes,sync_enabled from project_video_versions where project_id=$1 order by revision desc limit $2",[projectId,RETAINED_VERSIONS]);
  return rows.map(row=>({revision:row.revision,updatedAt:new Date(row.created_at).toISOString(),bytes:row.bytes,syncEnabled:row.sync_enabled}));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value!=="object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>[key,canonical(item)]));
}

async function validateCloudAssets(db: PoolClient, userId: string, workspaceId: string, input: ProjectVideoWrite) {
  const ids=[...new Set(input.document.assets.flatMap(asset=>asset.assetId ? [asset.assetId] : []))];
  if (!ids.length) return;
  const {rows}=await db.query<{id:string}>(`select ao.id from asset_objects ao where ao.id=any($1::uuid[]) and ao.created_by=$2 and ao.workspace_id=$3
    and not exists(select 1 from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path and (ga.deleted_at is not null or ga.retention_state<>'active' or ga.retention_until<=now()))`,[ids,userId,workspaceId]);
  if (rows.length!==ids.length) throw new ProjectContextError(409,"project_asset_unavailable","部分云端素材已失效或不可访问，请重新关联后同步；本机文件仍保留。");
}

export async function writeVideoDocument(db: Pool, userId: string, projectId: string, input: ProjectVideoWrite) {
  const serialized=JSON.stringify(canonical(input.document));
  if (Buffer.byteLength(serialized)>MAX_DOCUMENT_BYTES) throw new ProjectContextError(413,"project_document_too_large","工程描述超过 2 MiB 上限；原视频无需上传，请减少内嵌内容后重试。");
  const fingerprint=createHash("sha256").update(serialized).update(String(input.syncEnabled)).digest("hex");
  const client=await db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`project-video:${projectId}`]);
    const workspaceId=await authorizeProject(client,userId,projectId,true);
    const replay=await client.query("select fingerprint,revision from project_video_versions where project_id=$1 and mutation_id=$2",[projectId,input.mutationId]);
    if (replay.rows[0]) {
      if (replay.rows[0].fingerprint!==fingerprint) throw new ProjectContextError(409,"project_save_key_reused","保存请求内容发生变化，请生成新的保存请求。");
      const saved=await readVideoDocument(client,userId,projectId,replay.rows[0].revision);
      await client.query("commit");return saved;
    }
    const current=await client.query("select revision from project_video_documents where project_id=$1 for update",[projectId]);
    const revision=Number(current.rows[0]?.revision ?? 0);
    if (revision!==input.expectedRevision) throw new ProjectContextError(409,"project_document_conflict","其他设备保存了新版本。请比较版本后选择继续，本机修改未覆盖云端。");
    await validateCloudAssets(client,userId,workspaceId,input);
    await client.query(`insert into project_video_documents(project_id,revision,sync_enabled,document) values($1,$2,$3,$4::jsonb)
      on conflict(project_id) do update set revision=excluded.revision,sync_enabled=excluded.sync_enabled,document=excluded.document,updated_at=clock_timestamp()`,[projectId,revision+1,input.syncEnabled,serialized]);
    await client.query("insert into project_video_versions(project_id,revision,mutation_id,fingerprint,document,sync_enabled,created_at) select $1,$2,$3,$4,$5::jsonb,$6,updated_at from project_video_documents where project_id=$1",[projectId,revision+1,input.mutationId,fingerprint,serialized,input.syncEnabled]);
    await client.query("delete from project_video_versions where project_id=$1 and revision<=$2",[projectId,revision+1-RETAINED_VERSIONS]);
    const saved=await readVideoDocument(client,userId,projectId);
    await client.query("commit");return saved;
  } catch(error) {await client.query("rollback");throw error;} finally {client.release();}
}
