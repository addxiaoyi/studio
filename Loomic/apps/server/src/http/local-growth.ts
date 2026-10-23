import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { loadAdminOverviewCharts } from "../local-db/admin-overview-charts.js";
import { loadHomeOverview, type HomeOverviewRange } from "../local-db/home-overview-service.js";
import { sealModelSecret } from "../local-db/model-settings-crypto.js";

type GrowthOptions = {
  auth: RequestAuthenticator;
  db: Pool;
  viewerService: ViewerService;
};

const SOCIAL_OAUTH_ENV_FIELDS = [
  "DOUYIN_CLIENT_ID", "DOUYIN_CLIENT_KEY", "DOUYIN_CLIENT_SECRET", "DOUYIN_OAUTH_SCOPES", "DOUYIN_OAUTH_REDIRECT_URI", "DOUYIN_AUTH_URL", "DOUYIN_TOKEN_URL", "DOUYIN_PUBLISH_REVIEWED",
  "XIAOHONGSHU_CLIENT_ID", "XIAOHONGSHU_CLIENT_SECRET", "XIAOHONGSHU_OAUTH_SCOPES", "XIAOHONGSHU_OAUTH_REDIRECT_URI", "XIAOHONGSHU_AUTH_URL", "XIAOHONGSHU_TOKEN_URL", "XIAOHONGSHU_PUBLISH_REVIEWED",
  "KUAISHOU_CLIENT_ID", "KUAISHOU_CLIENT_SECRET", "KUAISHOU_OAUTH_SCOPES", "KUAISHOU_OAUTH_REDIRECT_URI", "KUAISHOU_AUTH_URL", "KUAISHOU_TOKEN_URL", "KUAISHOU_PUBLISH_REVIEWED",
  "ZHIHU_CLIENT_ID", "ZHIHU_CLIENT_SECRET", "ZHIHU_OAUTH_SCOPES", "ZHIHU_OAUTH_REDIRECT_URI", "ZHIHU_AUTH_URL", "ZHIHU_TOKEN_URL", "ZHIHU_PUBLISH_REVIEWED",
  "BILIBILI_CLIENT_ID", "BILIBILI_CLIENT_SECRET", "BILIBILI_OAUTH_SCOPES", "BILIBILI_OAUTH_REDIRECT_URI", "BILIBILI_AUTH_URL", "BILIBILI_TOKEN_URL", "BILIBILI_PUBLISH_REVIEWED",
  "WECHAT_CHANNELS_CLIENT_ID", "WECHAT_CHANNELS_CLIENT_SECRET", "WECHAT_CHANNELS_OAUTH_SCOPES", "WECHAT_CHANNELS_OAUTH_REDIRECT_URI", "WECHAT_CHANNELS_AUTH_URL", "WECHAT_CHANNELS_TOKEN_URL", "WECHAT_CHANNELS_PUBLISH_REVIEWED",
  "WECHAT_OFFICIAL_CLIENT_ID", "WECHAT_OFFICIAL_CLIENT_SECRET", "WECHAT_OFFICIAL_OAUTH_SCOPES", "WECHAT_OFFICIAL_OAUTH_REDIRECT_URI", "WECHAT_OFFICIAL_AUTH_URL", "WECHAT_OFFICIAL_TOKEN_URL", "WECHAT_OFFICIAL_PUBLISH_REVIEWED",
] as const;

export function registerPublicGrowthRoutes(app: FastifyInstance): void {
  // Gallery and prompt routes are registered with the local database below.
}

async function viewer(
  options: GrowthOptions,
  request: Parameters<FastifyInstance["get"]>[1] extends never ? never : any,
) {
  const user = await options.auth.authenticate(request);
  if (!user) return null;
  return { user, viewer: await options.viewerService.ensureViewer(user) };
}

export function registerLocalGrowthRoutes(
  app: FastifyInstance,
  options: GrowthOptions,
): void {
  const requireSession = async (request: any, reply: any) => {
    const session = await viewer(options, request);
    if (!session) { await reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } }); return null; }
    return session;
  };
  const requireAdmin = async (request: any, reply: any) => {
    const session = await requireSession(request, reply); if (!session) return null;
    const { rows } = await options.db.query(
      "select system_role from app_users where id = $1",
      [session.user.id],
    );
    if (rows[0]?.system_role !== "admin") {
      await reply.code(403).send({ error: { code: "forbidden", message: "System administrator role required" } });
      return null;
    }
    return session;
  };

  app.get("/api/home/overview", async (request: any, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;

    const requestedDays = Number(request.query?.days ?? 14);
    if (![7, 14, 30].includes(requestedDays)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_period", message: "Choose a 7, 14, or 30 day period." },
      });
    }

    const data = await loadHomeOverview(
      options.db,
      session.viewer.workspace.id,
      requestedDays as HomeOverviewRange,
    );
    return reply.send({ ok: true, data });
  });

  app.get("/api/assets/history", async (request: any, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const page = Math.max(1, Number(request.query?.page ?? 1));
    const pageSize = Math.min(Math.max(Number(request.query?.pageSize ?? request.query?.limit ?? 24), 1), 60);
    const offset = (page - 1) * pageSize;
    const query = typeof request.query?.q === "string" ? request.query.q.trim() : "";
    const mediaType = request.query?.mediaType === "image" || request.query?.mediaType === "video" ? request.query.mediaType : null;
    const includeDeleted = request.query?.includeDeleted === "1";
    const generatedJoin = includeDeleted ? "" : " and ga.deleted_at is null";
    const retentionWindow = includeDeleted
      ? "and ((coalesce(ga.retention_until, ao.created_at + interval '3 days') > now() and coalesce(ga.retention_state, 'active') = 'active') or (ga.retention_state = 'soft_deleted' and ga.purge_after > now()))"
      : "and coalesce(ga.retention_until, ao.created_at + interval '3 days') > now() and coalesce(ga.retention_state, 'active') = 'active'";
    const { rows } = await options.db.query(`select coalesce(ga.id, ao.id) as id, ao.project_id,
      ga.source_job_id, ga.retention_state, ga.retention_until, ga.purge_after, ga.deleted_at, case when ao.mime_type like 'video/%' then 'video' else 'image' end as media_type,
      exists(select 1 from gallery_items gi where gi.asset_id=ga.id and gi.status='published' and gi.deleted_at is null) as published,
      ao.object_path, ao.mime_type, ga.title, ga.description, ga.prompt, ga.metadata,
      ao.created_at, ao.id as asset_object_id
      from asset_objects ao
      left join generated_assets ga on ga.workspace_id=ao.workspace_id
        and ga.object_path=ao.object_path${generatedJoin}
      where ao.workspace_id=$1
        and (ao.mime_type like 'image/%' or ao.mime_type like 'video/%')
        ${retentionWindow}
        -- Canvas snapshots are implementation details, not user assets.
        and ao.object_path not like '%/gen-canvas-screenshot-%'
        and ($2::text is null or case when ao.mime_type like 'video/%' then 'video' else 'image' end=$2)
        and ($3::text = '' or coalesce(ga.title,'') ilike '%' || $3 || '%' or coalesce(ga.prompt,'') ilike '%' || $3 || '%')
      order by ao.created_at desc limit $4 offset $5`, [session.viewer.workspace.id, mediaType, query, pageSize, offset]);
    const count = await options.db.query(`select count(*)::int as total from asset_objects ao
      left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path${generatedJoin}
      where ao.workspace_id=$1 and (ao.mime_type like 'image/%' or ao.mime_type like 'video/%')
        ${retentionWindow} and ao.object_path not like '%/gen-canvas-screenshot-%'
        and ($2::text is null or case when ao.mime_type like 'video/%' then 'video' else 'image' end=$2)
        and ($3::text = '' or coalesce(ga.title,'') ilike '%' || $3 || '%' or coalesce(ga.prompt,'') ilike '%' || $3 || '%')`, [session.viewer.workspace.id, mediaType, query]);
    return { ok: true, data: rows, pagination: { page, pageSize, total: count.rows[0]?.total ?? 0, hasMore: offset + rows.length < (count.rows[0]?.total ?? 0) } };
  });
  app.get("/api/assets/:assetId/retention", async (request: any, reply: any) => {
    const session = await requireSession(request, reply); if (!session) return;
    const { rows } = await options.db.query(
      `select ga.id as asset_id, ga.retention_state, ga.retention_until, ga.purge_after,
              exists(select 1 from asset_favorites af where af.asset_id=ga.id and af.user_id=$3) as favorited
       from generated_assets ga where ga.id=$1 and ga.workspace_id=$2`,
      [request.params.assetId, session.viewer.workspace.id, session.user.id],
    );
    if (!rows[0]) return reply.code(404).send({ ok: false, error: { code: "asset_not_found", message: "Asset not found" } });
    return { ok: true, data: { assetId: rows[0].asset_id, state: rows[0].retention_state, retentionUntil: rows[0].retention_until, purgeAfter: rows[0].purge_after, favorited: rows[0].favorited } };
  });
  app.post("/api/assets/:assetId/restore", async (request: any, reply: any) => {
    const session = await requireSession(request, reply); if (!session) return;
    const { rows } = await options.db.query(
      `update generated_assets set deleted_at=null, retention_state='active', retention_until=now() + interval '3 days', purge_after=null, updated_at=now()
       where id=$1 and workspace_id=$2 and created_by=$3 and retention_state='soft_deleted' returning id,retention_state,retention_until,purge_after`,
      [request.params.assetId, session.viewer.workspace.id, session.user.id],
    );
    if (!rows[0]) return reply.code(409).send({ ok: false, error: { code: "asset_not_restorable", message: "Asset is not in the recovery period." } });
    await options.db.query(
      `insert into notifications(workspace_id,user_id,type,title,body,metadata)
       values($1,$2,'asset_restored',$3,$4,$5::jsonb)`,
      [session.viewer.workspace.id, session.user.id, "Asset restored", "The cloud copy is available again for 3 days. Save a copy to your computer to keep it longer.", JSON.stringify({ assetId: rows[0].id })],
    );
    return { ok: true, data: { assetId: rows[0].id, state: rows[0].retention_state, retentionUntil: rows[0].retention_until, purgeAfter: rows[0].purge_after } };
  });
  app.delete<{ Params: { assetId: string } }>("/api/assets/:assetId", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const { rows } = await options.db.query(`update generated_assets set deleted_at=now(), retention_state='soft_deleted', purge_after=now() + interval '7 days', retention_until=coalesce(retention_until, now()), updated_at=now()
      where id=$1 and workspace_id=$2 and created_by=$3 and deleted_at is null returning id`, [request.params.assetId, session.viewer.workspace.id, session.user.id]);
    const rowCount = rows.length;
    if (!rowCount) return reply.code(404).send({ error: { code: "asset_not_found", message: "资产不存在或已删除" } });
    await options.db.query(
      `insert into notifications(workspace_id,user_id,type,title,body,metadata)
       values($1,$2,'asset_soft_deleted',$3,$4,$5::jsonb)`,
      [session.viewer.workspace.id, session.user.id, "Asset moved to recovery", "This asset can be restored within 7 days.", JSON.stringify({ assetId: rows[0].id, purgeAfterDays: 7 })],
    );
    return { ok: true, data: { id: request.params.assetId } };
  });
  app.post("/api/assets/batch-delete", async (request: any, reply: any) => {
    const session = await requireSession(request, reply); if (!session) return;
    const assetIds = Array.isArray(request.body?.assetIds)
      ? [...new Set(request.body.assetIds.filter((id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 100)
      : [];
    if (!assetIds.length) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "请选择至少一个资产" } });
    const client = await options.db.connect();
    try {
      await client.query("begin");
      const deletedGenerated = await client.query<{ id: string }>(
        `update generated_assets ga set deleted_at=now(), retention_state='soft_deleted', purge_after=now() + interval '7 days', retention_until=coalesce(retention_until, now()), updated_at=now()
         where ga.workspace_id=$1 and ga.id=any($2::uuid[]) and ga.created_by=$3 and ga.deleted_at is null
         returning ga.id`,
        [session.viewer.workspace.id, assetIds, session.user.id],
      );
      if (deletedGenerated.rows.length) {
        await client.query(
          `insert into notifications(workspace_id,user_id,type,title,body,metadata)
           select workspace_id,created_by,'asset_soft_deleted',$3,$4,jsonb_build_object('assetId',id,'purgeAfterDays',7)
           from generated_assets where id = any($1::uuid[]) and workspace_id=$2 and created_by=$5`,
          [deletedGenerated.rows.map((row) => row.id), session.viewer.workspace.id, "Asset moved to recovery", "Selected assets can be restored within 7 days.", session.user.id],
        );
      }
      const deletedUploads = await client.query<{ id: string }>(
        `delete from asset_objects ao
         where ao.workspace_id=$1 and ao.id=any($2::uuid[]) and ao.created_by=$3
           and not exists (
             select 1 from generated_assets ga
             where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path and ga.deleted_at is null
           )
         returning ao.id`,
        [session.viewer.workspace.id, assetIds, session.user.id],
      );
      await client.query("commit");
      const deleted = [...deletedGenerated.rows, ...deletedUploads.rows].map((row) => row.id);
      return { ok: true, data: { deletedIds: deleted, deletedCount: deleted.length, requestedCount: assetIds.length } };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });  app.post<{ Params: { assetId: string } }>("/api/assets/:assetId/favorite", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const id = request.params.assetId;
    const exists = await options.db.query("select 1 from generated_assets where id=$1 and workspace_id=$2 and deleted_at is null", [id, session.viewer.workspace.id]);
    if (!exists.rowCount) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found" } });
    const added = await options.db.query("insert into asset_favorites(asset_id,user_id) values($1,$2) on conflict do nothing returning asset_id", [id, session.user.id]);
    if (!added.rowCount) await options.db.query("delete from asset_favorites where asset_id=$1 and user_id=$2", [id, session.user.id]);
    return { ok: true, data: { favorited: Boolean(added.rowCount) } };
  });
  app.get("/api/gallery", async (request: any) => {
    const { rows } = await options.db.query(`select gi.id, gi.asset_id, gi.status, gi.featured, gi.like_count, gi.comment_count, gi.published_at,
      ga.title, ga.description, ga.prompt, ga.media_type, ga.metadata, ga.source_job_id,
      coalesce(nullif(owner.display_name,''), split_part(owner.email,'@',1), '匿名用户') as author_name,
      coalesce((ga.metadata->>'model'), (ga.metadata->'routing'->>'selectedModel'), (ga.metadata->'routing'->>'actualModel')) as model,
      coalesce(ga.metadata->>'resolution', ga.metadata->'routing'->>'resolution') as resolution,
      coalesce(nullif(ga.metadata->>'generationType',''), ga.media_type) as generation_type,
      case when ga.metadata->>'width' ~ '^[0-9]+$' then (ga.metadata->>'width')::int else null end as width,
      case when ga.metadata->>'height' ~ '^[0-9]+$' then (ga.metadata->>'height')::int else null end as height,
      ao.mime_type,
      concat('/api/uploads/', ao.id, '/file') as object_url
      from gallery_items gi
      join generated_assets ga on ga.id=gi.asset_id and ga.deleted_at is null
      left join app_users owner on owner.id=gi.owner_id
      left join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path
      where gi.status='published' and gi.deleted_at is null
      order by gi.featured desc, gi.published_at desc limit $1`, [Math.min(Number(request.query?.limit ?? 50), 100)]);
    return { ok: true, data: rows };
  });
  app.post<{ Params: { assetId: string }; Body: { title?: string; description?: string } }>("/api/gallery/:assetId/publish", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const asset = await options.db.query("select ga.id from generated_assets ga left join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path where (ga.id=$1 or ao.id=$1) and ga.workspace_id=$2 and ga.deleted_at is null and (ga.created_by=$3 or ao.created_by=$3) limit 1", [request.params.assetId, session.viewer.workspace.id, session.user.id]);
    let generatedAssetId = asset.rows[0]?.id as string | undefined;
    if (!generatedAssetId) {
      const legacy = await options.db.query("insert into generated_assets(workspace_id,object_path,mime_type,media_type,created_by,title,description,prompt) select workspace_id,object_path,mime_type,case when mime_type like 'video/%' then 'video' else 'image' end,created_by,'','', '' from asset_objects where id=$1 and workspace_id=$2 and created_by=$3 on conflict(workspace_id,object_path) do update set deleted_at=null returning id", [request.params.assetId, session.viewer.workspace.id, session.user.id]);
      generatedAssetId = legacy.rows[0]?.id as string | undefined;
    }
    if (!generatedAssetId) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found or not owned by the current user" } });
    const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 200) : null;
    const description = typeof request.body?.description === "string" ? request.body.description.trim().slice(0, 2000) : null;
    if (title !== null || description !== null) await options.db.query("update generated_assets set title=coalesce($1,title), description=coalesce($2,description) where id=$3", [title, description, generatedAssetId]);
    const { rows } = await options.db.query("insert into gallery_items(asset_id,workspace_id,owner_id,status,published_at) values($1,$2,$3,'published',now()) on conflict(asset_id) do update set status='published', deleted_at=null, published_at=now(), updated_at=now() returning id, asset_id, status, published_at", [generatedAssetId, session.viewer.workspace.id, session.user.id]);
    return { ok: true, data: rows[0] };
  });
  app.delete<{ Params: { assetId: string } }>("/api/gallery/:assetId/publish", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const { rowCount } = await options.db.query("update gallery_items gi set status='hidden', deleted_at=now(), updated_at=now() from generated_assets ga left join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path where gi.asset_id=ga.id and (gi.asset_id=$1 or ao.id=$1) and gi.workspace_id=$2 and gi.owner_id=$3 and gi.status='published'", [request.params.assetId, session.viewer.workspace.id, session.user.id]);
    if (!rowCount) return reply.code(404).send({ error: { code: "published_asset_not_found", message: "公开作品不存在或已取消公开" } });
    return { ok: true, data: { asset_id: request.params.assetId, status: "hidden" } };
  });
  app.post<{ Params: { galleryId: string } }>("/api/gallery/:galleryId/like", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const client = await options.db.connect(); try { await client.query("begin"); const ins = await client.query("insert into gallery_likes(gallery_id,user_id) values($1,$2) on conflict do nothing returning gallery_id", [request.params.galleryId, session.user.id]); const delta = ins.rowCount ? 1 : -1; if (!ins.rowCount) await client.query("delete from gallery_likes where gallery_id=$1 and user_id=$2", [request.params.galleryId, session.user.id]); const { rows } = await client.query("update gallery_items set like_count=greatest(0,like_count+$2) where id=$1 returning like_count", [request.params.galleryId, delta]); await client.query("commit"); return { ok: true, data: { liked: delta === 1, likeCount: rows[0]?.like_count ?? 0 } }; } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
  });
  app.post<{ Params: { galleryId: string }; Body: { body?: string; requestId?: string } }>("/api/gallery/:galleryId/comments", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const body = String(request.body?.body ?? "").trim(); if (!body || body.length > 1000) return reply.code(400).send({ error: { code: "invalid_body", message: "Comment must be 1-1000 characters" } });
    const requestId = request.body?.requestId ?? randomUUID();
    const { rows } = await options.db.query(
      `with saved as (
        insert into gallery_comments(gallery_id,user_id,body,request_id)
        values($1,$2,$3,$4)
        on conflict(user_id,request_id) do update set body=excluded.body
        returning id,gallery_id,user_id,body,created_at
      )
      select saved.id,saved.gallery_id,saved.user_id,saved.body,saved.created_at,
        coalesce(nullif(u.display_name,''), split_part(u.email,'@',1), '匿名用户') as author_name,
        true as can_delete
      from saved join app_users u on u.id=saved.user_id`,
      [request.params.galleryId, session.user.id, body, requestId],
    );
    await options.db.query("update gallery_items set comment_count=(select count(*) from gallery_comments where gallery_id=$1 and status='visible') where id=$1", [request.params.galleryId]);
    return { ok: true, data: rows[0] };
  });
  app.get<{ Params: { galleryId: string } }>("/api/gallery/:galleryId/comments", async (request) => {
    const session = await viewer(options, request);
    const { rows } = await options.db.query(
      `select c.id,c.gallery_id,c.user_id,c.body,c.created_at,
        coalesce(nullif(u.display_name,''), split_part(u.email,'@',1), '匿名用户') as author_name,
        (c.user_id=$2::uuid) as can_delete
      from gallery_comments c
      join app_users u on u.id=c.user_id
      where c.gallery_id=$1 and c.status='visible'
      order by c.created_at asc limit 100`,
      [request.params.galleryId, session?.user.id ?? null],
    );
    return { ok: true, data: rows };
  });
  app.delete<{ Params: { commentId: string } }>("/api/gallery/comments/:commentId", async (request, reply) => {
    const session = await requireSession(request, reply); if (!session) return;
    const { rows } = await options.db.query("update gallery_comments set status='removed' where id=$1 and user_id=$2 and status='visible' returning gallery_id", [request.params.commentId, session.user.id]);
    if (!rows[0]) return reply.code(404).send({ error: { code: "comment_not_found", message: "评论不存在或无权删除" } });
    await options.db.query("update gallery_items set comment_count=(select count(*) from gallery_comments where gallery_id=$1 and status='visible') where id=$1", [rows[0].gallery_id]);
    return { ok: true, data: { id: request.params.commentId } };
  });
  app.get("/api/prompts", async (request: any) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 50), 1), 100);
    const offset = Math.max(Number(request.query?.offset ?? 0), 0);
    const query = typeof request.query?.q === "string" ? request.query.q.trim() : "";
    const category = typeof request.query?.category === "string" ? request.query.category.trim() : "";
    const { rows } = await options.db.query(
      `select id,title,prompt,category,tags,favorite_count,view_count,source,source_url,license from prompt_entries
       where published=true and deleted_at is null
         and ($1::text is null or title ilike '%' || $1 || '%' or prompt ilike '%' || $1 || '%' or $1 = any(tags))
         and ($2::text is null or category=$2)
       order by favorite_count desc,created_at desc limit $3 offset $4`,
      [query || null, category || null, limit, offset],
    );
    const categories = await options.db.query("select category,count(*)::int as count from prompt_entries where published=true and deleted_at is null group by category order by count(*) desc,category");
    return { ok: true, data: rows, pagination: { offset, limit, hasMore: rows.length === limit }, categories: categories.rows };
  });
  app.post<{ Params: { promptId: string } }>("/api/prompts/:promptId/view", async (request, reply) => { const session = await requireSession(request, reply); if (!session) return; await options.db.query("update prompt_entries set view_count=view_count+1 where id=$1 and published=true and deleted_at is null", [request.params.promptId]); return { ok: true }; });
  app.post<{ Params: { promptId: string } }>("/api/prompts/:promptId/favorite", async (request, reply) => { const session = await requireSession(request, reply); if (!session) return; const ins = await options.db.query("insert into prompt_favorites(prompt_id,user_id) values($1,$2) on conflict do nothing returning prompt_id", [request.params.promptId, session.user.id]); if (!ins.rowCount) await options.db.query("delete from prompt_favorites where prompt_id=$1 and user_id=$2", [request.params.promptId, session.user.id]); await options.db.query("update prompt_entries set favorite_count=(select count(*) from prompt_favorites where prompt_id=$1) where id=$1", [request.params.promptId]); return { ok: true, data: { favorited: Boolean(ins.rowCount) } }; });
  app.get<{ Params: { jobId: string } }>("/api/tasks/:jobId", async (request, reply) => { const session = await requireSession(request, reply); if (!session) return; const { rows } = await options.db.query("select * from background_jobs where id=$1 and workspace_id=$2", [request.params.jobId, session.viewer.workspace.id]); if (!rows[0]) return reply.code(404).send({ error: { code: "task_not_found", message: "Task not found" } }); return { ok: true, data: rows[0] }; });
  app.post<{ Params: { jobId: string } }>("/api/tasks/:jobId/retry", async (request, reply) => { const session = await requireSession(request, reply); if (!session) return; const { rows } = await options.db.query("update background_jobs set status='queued', error_code=null, error_message=null, failed_at=null, updated_at=now() where id=$1 and workspace_id=$2 and status='failed' and attempt_count < max_attempts returning *", [request.params.jobId, session.viewer.workspace.id]); if (!rows[0]) return reply.code(409).send({ error: { code: "task_not_retryable", message: "Task cannot be retried" } }); return { ok: true, data: rows[0] }; });
  app.get<{ Params: { jobId: string } }>("/api/tasks/:jobId/export", async (request, reply) => { const session = await requireSession(request, reply); if (!session) return; const { rows } = await options.db.query("select id, status, payload, result, error_code, error_message, created_at, completed_at from background_jobs where id=$1 and workspace_id=$2", [request.params.jobId, session.viewer.workspace.id]); if (!rows[0]) return reply.code(404).send({ error: { code: "task_not_found", message: "Task not found" } }); reply.header("content-disposition", `attachment; filename=task-${request.params.jobId}.json`).type("application/json"); return reply.send(JSON.stringify(rows[0], null, 2)); });
  app.get("/api/admin/audit", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("select * from admin_audit_logs where workspace_id=$1 order by created_at desc limit 100", [session.viewer.workspace.id]); return { ok: true, data: rows }; });
  app.get("/api/admin/overview", async (request: any, reply) => {
    const session = await requireAdmin(request, reply); if (!session) return;
    const workspaceId = typeof request.query?.workspaceId === "string" ? request.query.workspaceId : null;
    const requestedDays = Number(request.query?.days ?? 30);
    const periodDays = ([14, 30, 90].includes(requestedDays) ? requestedDays : 30) as 14 | 30 | 90;
    const scope = workspaceId ? " where workspace_id=$1" : "";
    const arg = workspaceId ? [workspaceId] : [];
    const [users, projects, jobs, assets, credits, workspaces, topups, paymentErrors, providers, charts] = await Promise.all([
      options.db.query(workspaceId ? "select count(distinct user_id)::int as count from workspace_members where workspace_id=$1" : "select count(*)::int as count from app_users", arg),
      options.db.query(`select count(*)::int as count from projects${scope}`, arg),
      options.db.query(`select count(*)::int as total, count(*) filter (where status in ('failed','dead_letter','sync_failed'))::int as failed, count(*) filter (where status in ('queued','running','sync_pending'))::int as active from background_jobs${scope}`, arg),
      options.db.query(`select count(*)::int as count from generated_assets${scope ? `${scope} and deleted_at is null` : " where deleted_at is null"}`, arg),
      options.db.query(`select coalesce(sum(abs(amount)),0)::int as spent from credit_transactions${scope ? `${scope} and amount < 0 and transaction_type='generation_deduct'` : " where amount < 0 and transaction_type='generation_deduct'"}`, arg),
      options.db.query("select count(*)::int as count from workspaces"),
      options.db.query("select count(*)::int as count from credit_topups"),
      options.db.query("select count(*)::int as count from payment_events where processed=false or error_message is not null"),
      options.db.query("select count(*)::int as total,count(*) filter(where enabled=true and health_status='healthy')::int as healthy from provider_configs"),
      loadAdminOverviewCharts(options.db, periodDays, workspaceId),
    ]);
    return { ok: true, data: { users: users.rows[0].count, workspaces: workspaces.rows[0].count, projects: projects.rows[0].count, jobs: jobs.rows[0], assets: assets.rows[0].count, creditsSpent: credits.rows[0].spent, topups: topups.rows[0].count, paymentErrors: paymentErrors.rows[0].count, providers: providers.rows[0], charts }, pagination: { page: 1, pageSize: 1, total: 1 } };
  });
  app.get("/api/admin/users", async (request: any, reply) => {
    const session = await requireAdmin(request, reply); if (!session) return;
    const page = Math.max(1, Number(request.query?.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(request.query?.pageSize ?? 50))); const offset = (page - 1) * pageSize; const workspaceId = typeof request.query?.workspaceId === "string" ? request.query.workspaceId : null; const q = typeof request.query?.q === "string" ? `%${request.query.q.trim()}%` : null;
    const where = workspaceId ? "where m.workspace_id=$1" : "where ($1::text is null or u.email ilike $1 or coalesce(u.display_name,'') ilike $1)"; const params = workspaceId ? [workspaceId, q, pageSize, offset] : [q, pageSize, offset]; const { rows } = await options.db.query(`select u.id,u.email,u.display_name,coalesce(string_agg(distinct w.name, ', '), '未加入工作区') as workspaces,u.system_role as role,max(m.created_at) as created_at,(select wm.workspace_id from workspace_members wm where wm.user_id=u.id order by wm.created_at limit 1) as workspace_id,coalesce((select cb.balance from credit_balances cb where cb.workspace_id=(select wm.workspace_id from workspace_members wm where wm.user_id=u.id order by wm.created_at limit 1)),0) as balance from app_users u left join workspace_members m on m.user_id=u.id left join workspaces w on w.id=m.workspace_id ${where} ${q ? "and (u.email ilike $2 or coalesce(u.display_name,'') ilike $2)" : ""} group by u.id,u.email,u.display_name,u.system_role order by max(u.created_at) desc nulls last limit $${params.length - 1} offset $${params.length}`, params);
    return { ok: true, data: rows, pagination: { page, pageSize, total: rows.length } };
  });
  app.patch("/api/admin/users/:userId", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const role = request.body?.role; if (role !== "admin" && role !== "member") return reply.code(400).send({ error: { code: "invalid_role", message: "角色只能是 admin 或 member" } }); const before = await options.db.query("select system_role from app_users where id=$1", [request.params.userId]); if (!before.rows[0]) return reply.code(404).send({ error: { code: "user_not_found", message: "用户不存在" } }); if (before.rows[0].system_role === "admin" && role === "member") { const admins = await options.db.query("select count(*)::int as count from app_users where system_role='admin'"); if (admins.rows[0].count <= 1) return reply.code(409).send({ error: { code: "last_admin", message: "不能移除最后一个系统管理员" } }); } const { rows } = await options.db.query("update app_users set system_role=$1, updated_at=now() where id=$2 returning id as user_id,system_role as role", [role, request.params.userId]); await options.db.query("insert into admin_audit_logs(workspace_id,actor_id,action,target_type,target_id,before_state,after_state) values($1,$2,'user_role_updated','user',$3,$4,$5)", [session.viewer.workspace.id, session.user.id, request.params.userId, JSON.stringify(before.rows[0]), JSON.stringify(rows[0])]); return { ok: true, data: rows[0] }; });
  app.post("/api/admin/users/:userId/credits", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const amount = Number(request.body?.amount); const workspaceId = request.body?.workspaceId; const reason = typeof request.body?.reason === "string" ? request.body.reason.trim().slice(0, 200) : "管理员调整"; if (!workspaceId || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) return reply.code(400).send({ ok: false, error: { code: "invalid_credit_adjustment", message: "积分调整参数无效" } }); const membership = await options.db.query("select 1 from workspace_members where workspace_id=$1 and user_id=$2", [workspaceId, request.params.userId]); if (!membership.rowCount) return reply.code(404).send({ ok: false, error: { code: "member_not_found", message: "用户不属于指定工作区" } }); const client = await options.db.connect(); try { await client.query("begin"); const balance = await client.query("insert into credit_balances(workspace_id,balance) values($1,0) on conflict(workspace_id) do update set balance=credit_balances.balance+$2,updated_at=now() where credit_balances.balance+$2>=0 returning balance", [workspaceId, amount]); if (!balance.rows[0]) throw Object.assign(new Error("余额不足，不能扣减"), { statusCode: 409 }); await client.query("insert into credit_transactions(workspace_id,user_id,transaction_type,amount,balance_after,description) values($1,$2,'admin_adjustment',$3,$4,$5)", [workspaceId, request.params.userId, amount, balance.rows[0].balance, reason]); await client.query("insert into admin_audit_logs(workspace_id,actor_id,action,target_type,target_id,after_state) values($1,$2,'credit_adjusted','user',$3,$4)", [workspaceId, session.user.id, request.params.userId, JSON.stringify({ amount, balanceAfter: balance.rows[0].balance, reason })]); await client.query("commit"); return { ok: true, data: { balance: balance.rows[0].balance } }; } catch (error) { await client.query("rollback"); const status = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 500; return reply.code(status).send({ ok: false, error: { code: "credit_adjustment_failed", message: error instanceof Error ? error.message : "积分调整失败" } }); } finally { client.release(); } });
  app.delete("/api/admin/users/:userId", async (request: any, reply) => {
    const session = await requireAdmin(request, reply); if (!session) return;
    const userId = request.params.userId;
    if (userId === session.user.id) return reply.code(409).send({ ok: false, error: { code: "cannot_delete_self", message: "不能删除当前登录的管理员账号" } });
    const target = await options.db.query("select id,email,system_role from app_users where id=$1", [userId]);
    if (!target.rows[0]) return reply.code(404).send({ ok: false, error: { code: "user_not_found", message: "用户不存在" } });
    if (target.rows[0].system_role === "admin") {
      const admins = await options.db.query("select count(*)::int as count from app_users where system_role='admin'");
      if (admins.rows[0].count <= 1) return reply.code(409).send({ ok: false, error: { code: "last_admin", message: "不能删除最后一个系统管理员" } });
    }
    const client = await options.db.connect();
    try {
      await client.query("begin");
      await client.query("delete from background_jobs where created_by=$1", [userId]);
      await client.query("delete from content_packages where created_by=$1", [userId]);
      await client.query("delete from publishing_plans where created_by=$1", [userId]);
      await client.query("delete from publishing_accounts where created_by=$1", [userId]);
      await client.query("delete from app_users where id=$1", [userId]);
      await client.query("insert into admin_audit_logs(workspace_id,actor_id,action,target_type,target_id,before_state) values($1,$2,'user_deleted','user',$3,$4)", [session.viewer.workspace.id, session.user.id, userId, JSON.stringify({ email: target.rows[0].email })]);
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      request.log.error({ err: error, userId }, "admin user deletion failed");
      return reply.code(409).send({ ok: false, error: { code: "user_has_dependencies", message: "该用户仍有关联数据，暂时无法删除。请先清理其项目或工作区。" } });
    } finally { client.release(); }
  });
  app.get("/api/admin/jobs", async (request: any, reply) => {
    const session = await requireAdmin(request, reply); if (!session) return;
    const page = Math.max(1, Number(request.query?.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(request.query?.pageSize ?? 50))); const offset = (page - 1) * pageSize; const workspaceId = typeof request.query?.workspaceId === "string" ? request.query.workspaceId : null; const status = typeof request.query?.status === "string" ? request.query.status : null; const type = typeof request.query?.type === "string" ? request.query.type : null; const values: unknown[] = [workspaceId, status, type, pageSize, offset]; const { rows } = await options.db.query("select bj.id,bj.workspace_id,bj.created_by,bj.job_type,bj.status,bj.attempt_count,bj.max_attempts,bj.error_code,bj.error_message,bj.credits_cost,bj.credits_transaction_id,rt.id as refund_transaction_id,rt.amount as refund_amount,bj.created_at,bj.started_at,bj.completed_at,bj.failed_at,bj.canceled_at from background_jobs bj left join lateral (select id,amount from credit_transactions where job_id=bj.id::text and transaction_type='generation_refund' order by created_at desc limit 1) rt on true where ($1::uuid is null or bj.workspace_id=$1) and ($2::text is null or bj.status=$2) and ($3::text is null or bj.job_type=$3) order by bj.created_at desc limit $4 offset $5", values); return { ok: true, data: rows, pagination: { page, pageSize, total: rows.length } };
  });
  app.post("/api/admin/jobs/:jobId/retry", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("update background_jobs set status='queued',error_code=null,error_message=null,failed_at=null,updated_at=now() where id=$1 and status in ('failed','dead_letter') and attempt_count < max_attempts returning id,status,attempt_count", [request.params.jobId]); if (!rows[0]) return reply.code(409).send({ error: { code: "job_not_retryable", message: "任务不可重试" } }); return { ok: true, data: rows[0] }; });
  app.post("/api/admin/jobs/:jobId/cancel", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("update background_jobs set status='canceled',canceled_at=now(),updated_at=now() where id=$1 and status in ('queued','running') returning id,status", [request.params.jobId]); if (!rows[0]) return reply.code(409).send({ error: { code: "job_not_cancelable", message: "任务当前不可取消" } }); return { ok: true, data: rows[0] }; });
  app.get("/api/admin/assets", async (request: any, reply) => {
    const session = await requireAdmin(request, reply); if (!session) return;
    const page = Math.max(1, Number(request.query?.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(request.query?.pageSize ?? 50))); const offset = (page - 1) * pageSize; const workspaceId = typeof request.query?.workspaceId === "string" ? request.query.workspaceId : null; const status = request.query?.status === "deleted" ? "deleted" : "active"; const values: unknown[] = [workspaceId, pageSize, offset]; const { rows } = await options.db.query(`select id,media_type,title,description,mime_type,object_path,created_by,created_at,deleted_at from generated_assets where ($1::uuid is null or workspace_id=$1) and ${status === "deleted" ? "deleted_at is not null" : "deleted_at is null"} order by created_at desc limit $2 offset $3`, values); return { ok: true, data: rows, pagination: { page, pageSize, total: rows.length } };
  });
  app.delete("/api/admin/assets/:assetId", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const result = await options.db.query("update generated_assets set deleted_at=now() where id=$1 and workspace_id=$2 and deleted_at is null", [request.params.assetId, session.viewer.workspace.id]); if (!result.rowCount) return reply.code(404).send({ error: { code: "asset_not_found", message: "素材不存在或已删除" } }); return { ok: true }; });
  app.patch("/api/admin/assets/:assetId", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 200) : ""; const description = typeof request.body?.description === "string" ? request.body.description.trim().slice(0, 2000) : ""; const { rows } = await options.db.query("update generated_assets set title=$1,description=$2 where id=$3 and workspace_id=$4 and deleted_at is null returning id,title,description", [title, description, request.params.assetId, session.viewer.workspace.id]); if (!rows[0]) return reply.code(404).send({ error: { code: "asset_not_found", message: "素材不存在或已删除" } }); return { ok: true, data: rows[0] }; });
  app.get("/api/admin/uploads", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("select id,object_path,mime_type,byte_size,created_by,created_at from asset_objects where workspace_id=$1 order by created_at desc limit 100", [session.viewer.workspace.id]); return { ok: true, data: rows }; });
  app.delete("/api/admin/uploads/:assetId", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const result = await options.db.query("delete from asset_objects where id=$1 and workspace_id=$2 returning id", [request.params.assetId, session.viewer.workspace.id]); if (!result.rowCount) return reply.code(404).send({ error: { code: "upload_not_found", message: "上传对象不存在" } }); return { ok: true }; });
  app.get("/api/admin/settings", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("select default_model,updated_at from workspace_settings where workspace_id=$1", [session.viewer.workspace.id]); return { ok: true, data: rows[0] ?? { default_model: null, updated_at: null } }; });
  app.get("/api/admin/chat-settings", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("select chat_model,default_model,updated_at from workspace_settings where workspace_id=$1", [session.viewer.workspace.id]); return { ok: true, data: rows[0] ?? { chat_model: null, default_model: null, updated_at: null } }; });
  app.put("/api/admin/chat-settings", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const chatModel = typeof request.body?.chatModel === "string" ? request.body.chatModel.trim() : ""; if (!chatModel || chatModel.length > 200) return reply.code(400).send({ error: { code: "invalid_chat_model", message: "聊天模型 ID 无效" } }); const { rows } = await options.db.query("insert into workspace_settings(workspace_id,default_model,chat_model) values($1,$2,$3) on conflict(workspace_id) do update set chat_model=excluded.chat_model,updated_at=now() returning chat_model,default_model,updated_at", [session.viewer.workspace.id, chatModel, chatModel]); return { ok: true, data: rows[0] }; });
  app.get("/api/admin/model-settings", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("select default_model,chat_model,default_model_url,chat_model_url,default_model_key_ciphertext,chat_model_key_ciphertext,updated_at from workspace_settings where workspace_id=$1", [session.viewer.workspace.id]); const row = rows[0] ?? {}; return { ok: true, data: { default_model: row.default_model ?? null, chat_model: row.chat_model ?? row.default_model ?? null, default_model_url: row.default_model_url ?? "", chat_model_url: row.chat_model_url ?? "", default_model_key_configured: Boolean(row.default_model_key_ciphertext), chat_model_key_configured: Boolean(row.chat_model_key_ciphertext), updated_at: row.updated_at ?? null } }; });
  app.put("/api/admin/model-settings", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const input = request.body ?? {}; const current = (await options.db.query("select * from workspace_settings where workspace_id=$1", [session.viewer.workspace.id])).rows[0] ?? {}; const model = typeof input.defaultModel === "string" && input.defaultModel.trim() ? input.defaultModel.trim() : String(current.default_model ?? ""); const chatModel = typeof input.chatModel === "string" && input.chatModel.trim() ? input.chatModel.trim() : String(current.chat_model ?? model); const defaultUrl = Object.prototype.hasOwnProperty.call(input, "defaultModelUrl") ? String(input.defaultModelUrl ?? "").trim() : String(current.default_model_url ?? ""); const chatUrl = Object.prototype.hasOwnProperty.call(input, "chatModelUrl") ? String(input.chatModelUrl ?? "").trim() : String(current.chat_model_url ?? ""); if (!model || !chatModel || model.length > 200 || chatModel.length > 200 || defaultUrl.length > 500 || chatUrl.length > 500) return reply.code(400).send({ error: { code: "invalid_model_settings", message: "模型配置无效" } }); const defaultKey = typeof input.defaultModelKey === "string" && input.defaultModelKey.trim() ? sealModelSecret(input.defaultModelKey.trim()) : (current.default_model_key_ciphertext ?? null); const chatKey = typeof input.chatModelKey === "string" && input.chatModelKey.trim() ? sealModelSecret(input.chatModelKey.trim()) : (current.chat_model_key_ciphertext ?? null); const { rows } = await options.db.query("insert into workspace_settings(workspace_id,default_model,chat_model,default_model_url,default_model_key_ciphertext,chat_model_url,chat_model_key_ciphertext) values($1,$2,$3,$4,$5,$6,$7) on conflict(workspace_id) do update set default_model=excluded.default_model,chat_model=excluded.chat_model,default_model_url=excluded.default_model_url,default_model_key_ciphertext=excluded.default_model_key_ciphertext,chat_model_url=excluded.chat_model_url,chat_model_key_ciphertext=excluded.chat_model_key_ciphertext,updated_at=now() returning default_model,chat_model,default_model_url,chat_model_url,updated_at", [session.viewer.workspace.id, model, chatModel, defaultUrl || null, defaultKey, chatUrl || null, chatKey]); return { ok: true, data: { ...rows[0], default_model_key_configured: Boolean(defaultKey), chat_model_key_configured: Boolean(chatKey) } }; });  app.get("/api/admin/env", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const names = ["AUTH_PROVIDER","DATABASE_URL","STORAGE_PROVIDER","STORAGE_ROOT","OPENAI_API_BASE","OPENAI_API_KEY","GOOGLE_API_KEY","REPLICATE_API_TOKEN","MAIL_HOST","MAIL_PORT","MAIL_USER","MAIL_FROM","LEMONSQUEEZY_API_KEY","YEEPAY_MERCHANT_ID","YEEPAY_BASE_URL","EPAY_BASE_URL","VOLCES_BASE_URL","WORKER_CONCURRENCY", ...SOCIAL_OAUTH_ENV_FIELDS]; const secret = /KEY|TOKEN|SECRET|PASSWORD|PRIVATE/i; const data = Object.fromEntries(names.map((name) => { const value = process.env[name] ?? ""; return [name, secret.test(name) && value ? `${value.slice(0, 3)}***${value.slice(-2)}` : value]; })); return { ok: true, data }; });
  app.put("/api/admin/env", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const allowed = new Set(["AUTH_PROVIDER","DATABASE_URL","STORAGE_PROVIDER","STORAGE_ROOT","OPENAI_API_BASE","OPENAI_API_KEY","GOOGLE_API_KEY","REPLICATE_API_TOKEN","MAIL_HOST","MAIL_PORT","MAIL_USER","MAIL_PASSWORD","MAIL_FROM","LEMONSQUEEZY_API_KEY","YEEPAY_MERCHANT_ID","YEEPAY_BASE_URL","EPAY_BASE_URL","VOLCES_BASE_URL","WORKER_CONCURRENCY", ...SOCIAL_OAUTH_ENV_FIELDS]); const input = request.body?.values; if (!input || typeof input !== "object" || Array.isArray(input)) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "values 必须是对象" } }); const entries: Array<[string, string]> = Object.entries(input).filter((entry): entry is [string, string] => allowed.has(entry[0]) && typeof entry[1] === "string" && entry[1].trim() !== ""); if (!entries.length) return reply.code(400).send({ ok: false, error: { code: "no_changes", message: "没有可保存的配置" } }); if (entries.some(([, value]) => value.includes("\n") || value.includes("\r"))) return reply.code(400).send({ ok: false, error: { code: "invalid_value", message: "配置值不能包含换行" } }); const file = process.env.HELSTERA_ENV_FILE ?? "/www/.env.local"; const current = await readFile(file, "utf8"); const pending = new Map<string, string>(entries); const next = current.split(/\r?\n/).map((line) => { const equal = line.indexOf("="); if (equal <= 0) return line; const key = line.slice(0, equal); const value = pending.get(key); if (value === undefined) return line; pending.delete(key); process.env[key] = value; return `${key}=${value}`; }); for (const [key, value] of pending) { next.push(`${key}=${value}`); process.env[key] = value; } await writeFile(file, `${next.filter((line, index, all) => index < all.length - 1 || line !== "").join("\n")}\n`, "utf8"); return { ok: true, data: { updated: entries.map(([key]) => key), restartRequired: true } }; });
  app.put("/api/admin/settings", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const model = typeof request.body?.defaultModel === "string" ? request.body.defaultModel.trim() : ""; if (model.length > 200) return reply.code(400).send({ error: { code: "invalid_default_model", message: "默认模型名称过长" } }); const { rows } = await options.db.query("insert into workspace_settings(workspace_id,default_model) values($1,$2) on conflict(workspace_id) do update set default_model=excluded.default_model,updated_at=now() returning default_model,updated_at", [session.viewer.workspace.id, model]); return { ok: true, data: rows[0] }; });
  app.get("/api/admin/billing", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const [tx, topups] = await Promise.all([options.db.query("select transaction_type,amount,description,created_at from credit_transactions where workspace_id=$1 order by created_at desc limit 100", [session.viewer.workspace.id]), options.db.query("select out_trade_no as id,amount_cny_fen,provider,status,created_at from credit_topups where workspace_id=$1 order by created_at desc limit 100", [session.viewer.workspace.id])]); return { ok: true, data: { transactions: tx.rows, topups: topups.rows } }; });
  app.get("/api/admin/payments", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const { rows } = await options.db.query("select event_name,provider_event_id,processed,error_message,created_at from payment_events where workspace_id=$1 order by created_at desc limit 100", [session.viewer.workspace.id]); return { ok: true, data: rows }; });
  app.get("/api/admin/health", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; const checks = await Promise.all([options.db.query("select 1 as ok"), options.db.query("select count(*)::int as count from provider_configs where workspace_id=$1", [session.viewer.workspace.id])]); return { ok: true, data: { database: checks[0].rows[0]?.ok === 1, providers: checks[1].rows[0]?.count ?? 0, checkedAt: new Date().toISOString() } }; });
  app.get("/api/admin/relays", async (request: any, reply) => { const session = await requireAdmin(request, reply); if (!session) return; return { ok: true, data: [] }; });
  app.get("/api/notifications", async (request, reply) => {
    const session = await viewer(options, request);
    if (!session)
      return reply
        .code(401)
        .send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const { rows } = await options.db.query(
      "select id, type, title, body, read_at, created_at from notifications where user_id=$1 order by created_at desc limit 50",
      [session.user.id],
    );
    return reply.send({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        readAt: row.read_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      })),
    });
  });

  app.get("/api/notifications/unread-count", async (request, reply) => {
    const session = await viewer(options, request);
    if (!session)
      return reply
        .code(401)
        .send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const { rows } = await options.db.query(
      "select count(*)::int as count from notifications where user_id=$1 and read_at is null",
      [session.user.id],
    );
    return reply.send({ ok: true, data: { count: rows[0]?.count ?? 0 } });
  });

  app.post<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    async (request, reply) => {
      const session = await viewer(options, request);
      if (!session)
        return reply
          .code(401)
          .send({ error: { code: "unauthorized", message: "Unauthorized" } });
      await options.db.query(
        "update notifications set read_at=coalesce(read_at, now()) where id=$1 and user_id=$2",
        [request.params.id, session.user.id],
      );
      return reply.send({ ok: true });
    },
  );

  app.post("/api/checkin", async (request, reply) => {
    const session = await viewer(options, request);
    if (!session)
      return reply
        .code(401)
        .send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const client = await options.db.connect();
    try {
      await client.query("begin");
      const today = new Date().toISOString().slice(0, 10);
      const existing = await client.query(
        "select streak, credits_granted from daily_checkins where user_id=$1 and checkin_date=$2",
        [session.user.id, today],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return reply.send({
          ok: true,
          data: { claimed: false, ...existing.rows[0] },
        });
      }
      const previous = await client.query(
        "select streak from daily_checkins where user_id=$1 order by checkin_date desc limit 1",
        [session.user.id],
      );
      const streak = previous.rows[0]?.streak ?? 0;
      const credits = Math.min(100, 20 + streak * 5);
      await client.query(
        "insert into daily_checkins(workspace_id,user_id,checkin_date,streak,credits_granted) values($1,$2,$3,$4,$5)",
        [
          session.viewer.workspace.id,
          session.user.id,
          today,
          streak + 1,
          credits,
        ],
      );
      await client.query(
        "insert into credit_transactions(workspace_id,user_id,transaction_type,amount,description) values($1,$2,'daily_checkin',$3,'Daily check-in')",
        [session.viewer.workspace.id, session.user.id, credits],
      );
      await client.query(
        "update credit_balances set balance=balance+$2, updated_at=now() where workspace_id=$1",
        [session.viewer.workspace.id, credits],
      );
      await client.query("commit");
      return reply.send({
        ok: true,
        data: { claimed: true, streak: streak + 1, credits },
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/invites", async (request, reply) => {
    const session = await viewer(options, request);
    if (!session)
      return reply
        .code(401)
        .send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const code = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const { rows } = await options.db.query(
      "insert into invites(workspace_id,inviter_id,code) values($1,$2,$3) returning code",
      [session.viewer.workspace.id, session.user.id, code],
    );
    return reply.send({ ok: true, data: rows[0] });
  });
}
