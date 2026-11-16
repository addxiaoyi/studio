import { randomUUID } from "node:crypto";
import { MAX_GALLERY_CAPTION_BYTES, parseGalleryCaptions, type GalleryCaptionSnapshot } from "@helstera/shared";
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";
import {
  GalleryError,
  listGalleryComments,
  publishGalleryAsset,
  publishedGallery,
  removeGalleryComment,
  saveGalleryComment,
  toggleAssetFavorite,
  toggleGalleryLike,
} from "../features/assets/gallery-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { registerGalleryCaptionRoutes } from "./gallery-captions.js";

type GalleryOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
};
const identifier = z.string().uuid();
const listQuery = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .default("50")
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
});
const publicationBody = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  caption: z.object({ vtt: z.string().max(MAX_GALLERY_CAPTION_BYTES), language: z.string().max(30), label: z.string().trim().min(1).max(60), consent: z.literal(true) }).strict().optional(),
});
const commentBody = z.object({
  body: z.string().trim().min(1).max(1000),
  requestId: z.string().uuid().optional(),
});

export const assetHistoryQuery = z.object({
  page: z
    .string()
    .regex(/^\d+$/)
    .default("1")
    .transform(Number)
    .pipe(z.number().int().min(1).max(35_000_000)),
  pageSize: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(60))
    .optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(60))
    .optional(),
  q: z.string().trim().max(1000).default(""),
  mediaType: z.enum(["image", "video"]).optional(),
  includeDeleted: z.enum(["0", "1"]).optional(),
});

function galleryId(value: string) {
  const parsed = identifier.safeParse(value);
  if (!parsed.success)
    throw new GalleryError("invalid_gallery_id", "作品或素材标识无效。", 400);
  return parsed.data;
}

function galleryFailure(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof GalleryError)
    return reply
      .code(error.statusCode)
      .send({ ok: false, error: { code: error.code, message: error.message } });
  if (
    error.code?.startsWith("FST_ERR_CTP_") &&
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return reply.code(error.statusCode).send({
      ok: false,
      error: {
        code: "invalid_gallery_request",
        message: "请求内容或格式无效。",
      },
    });
  }
  request.log.error({ err: error }, "gallery request failed");
  return reply.code(500).send({
    ok: false,
    error: {
      code: "gallery_unavailable",
      message: "作品服务暂不可用，请稍后重试。",
    },
  });
}

export function registerGalleryRoutes(
  app: FastifyInstance,
  options: GalleryOptions,
) {
  registerGalleryCaptionRoutes(app, options.db);
  const routeOptions = { errorHandler: galleryFailure };
  async function session(request: FastifyRequest) {
    const user = await options.auth.authenticate(request);
    if (!user) throw new GalleryError("unauthorized", "请先登录。", 401);
    const viewer = await options.viewerService.ensureViewer(user);
    return { userId: user.id, workspaceId: viewer.workspace.id };
  }

  app.get("/api/gallery", routeOptions, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const query = listQuery.safeParse(request.query);
    if (!query.success)
      throw new GalleryError(
        "invalid_gallery_query",
        "作品查询参数无效。",
        400,
      );
    const { rows } = await options.db.query(
      `select gi.id,gi.asset_id,gi.status,gi.featured,gi.like_count,gi.comment_count,gi.published_at,
      ga.title,ga.description,ga.prompt,ga.media_type,ga.metadata,ga.source_job_id,
      coalesce(nullif(owner.display_name,''),split_part(owner.email,'@',1),'匿名用户') as author_name,
      coalesce(ga.metadata->>'model',ga.metadata->'routing'->>'selectedModel',ga.metadata->'routing'->>'actualModel') as model,
      coalesce(ga.metadata->>'resolution',ga.metadata->'routing'->>'resolution') as resolution,
      coalesce(nullif(ga.metadata->>'generationType',''),ga.media_type) as generation_type,
      case when ga.metadata->>'width' ~ '^[0-9]{1,5}$' then (ga.metadata->>'width')::int else null end as width,
      case when ga.metadata->>'height' ~ '^[0-9]{1,5}$' then (ga.metadata->>'height')::int else null end as height,
      ao.mime_type,concat('/api/gallery/',gi.id,'/media') as object_url,
      case when gi.caption_snapshot is not null then jsonb_build_object('url',concat('/api/gallery/',gi.id,'/captions.vtt'),'language',gi.caption_snapshot->>'language','label',gi.caption_snapshot->>'label') else null end as caption
      from gallery_items gi join generated_assets ga on ga.id=gi.asset_id and ga.workspace_id=gi.workspace_id
      left join app_users owner on owner.id=gi.owner_id
      left join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path
      where ${publishedGallery} order by gi.featured desc,gi.published_at desc,gi.id desc limit $1`,
      [query.data.limit],
    );
    return { ok: true, data: rows };
  });

  app.post<{ Params: { assetId: string } }>(
    "/api/gallery/:assetId/publish",
    routeOptions,
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await session(request);
      const assetId = galleryId(request.params.assetId);
      const body = publicationBody.safeParse(request.body ?? {});
      if (!body.success)
        throw new GalleryError(
          "invalid_publication",
          "作品标题或描述无效。",
          400,
        );
      let caption: GalleryCaptionSnapshot | undefined;
      if (body.data.caption) {
        try { caption = parseGalleryCaptions(body.data.caption); }
        catch (error) { throw new GalleryError("invalid_caption", error instanceof Error ? error.message : "字幕格式无效。", 400); }
      }
      return {
        ok: true,
        data: await publishGalleryAsset(options.db, {
          ...actor,
          assetId,
          ...(body.data.title === undefined ? {} : { title: body.data.title }),
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(caption ? { caption } : {}),
        }),
      };
    },
  );
  app.delete<{ Params: { assetId: string } }>(
    "/api/gallery/:assetId/publish",
    routeOptions,
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await session(request);
      const assetId = galleryId(request.params.assetId);
      const hidden = await options.db.query(
        `update gallery_items gi set status='hidden',deleted_at=now(),updated_at=now()
      from generated_assets ga where gi.asset_id=ga.id and gi.workspace_id=ga.workspace_id and gi.workspace_id=$2 and gi.owner_id=$3 and gi.status='published'
        and (ga.id=$1 or exists(select 1 from asset_objects ao where ao.id=$1 and ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path)) returning gi.id`,
        [assetId, actor.workspaceId, actor.userId],
      );
      if (!hidden.rows[0])
        throw new GalleryError(
          "published_asset_not_found",
          "公开作品不存在或已取消公开。",
          404,
        );
      return { ok: true, data: { asset_id: assetId, status: "hidden" } };
    },
  );

  app.post<{ Params: { galleryId: string } }>(
    "/api/gallery/:galleryId/like",
    routeOptions,
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await session(request);
      return {
        ok: true,
        data: await toggleGalleryLike(
          options.db,
          galleryId(request.params.galleryId),
          actor.userId,
        ),
      };
    },
  );
  app.post<{ Params: { galleryId: string } }>(
    "/api/gallery/:galleryId/comments",
    routeOptions,
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await session(request);
      const id = galleryId(request.params.galleryId);
      const body = commentBody.safeParse(request.body);
      if (!body.success)
        throw new GalleryError(
          "invalid_body",
          "评论须为 1–1000 字，提交标识必须有效。",
          400,
        );
      return {
        ok: true,
        data: await saveGalleryComment(options.db, {
          galleryId: id,
          userId: actor.userId,
          body: body.data.body,
          requestId: body.data.requestId ?? randomUUID(),
        }),
      };
    },
  );
  app.get<{ Params: { galleryId: string } }>(
    "/api/gallery/:galleryId/comments",
    routeOptions,
    async (request, reply) => {
      reply
        .header("Cache-Control", "private, no-store")
        .header("Vary", "Authorization, Cookie");
      const id = galleryId(request.params.galleryId);
      const user = await options.auth.authenticate(request);
      return {
        ok: true,
        data: await listGalleryComments(options.db, id, user?.id ?? null),
      };
    },
  );
  app.delete<{ Params: { commentId: string } }>(
    "/api/gallery/comments/:commentId",
    routeOptions,
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await session(request);
      return {
        ok: true,
        data: await removeGalleryComment(
          options.db,
          galleryId(request.params.commentId),
          actor.userId,
        ),
      };
    },
  );
  app.post<{ Params: { assetId: string } }>(
    "/api/assets/:assetId/favorite",
    routeOptions,
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await session(request);
      return {
        ok: true,
        data: await toggleAssetFavorite(options.db, {
          ...actor,
          id: galleryId(request.params.assetId),
        }),
      };
    },
  );
}
