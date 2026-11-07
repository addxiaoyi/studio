import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import sharp from "sharp";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { PrivateVideoConflict, savePrivateVideo, savePrivateImage } from "../features/assets/private-video.js";
import type { StorageProvider } from "../storage/storage-provider.js";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isVideo(bytes: Buffer, mime: string): mime is "video/mp4" | "video/webm" {
  if (mime === "video/mp4") return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  return mime === "video/webm" && bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

type PrivateMediaOptions = {
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  db: Pool;
  storage: StorageProvider;
};

export function registerPrivateVideoRoutes(app: FastifyInstance, options: PrivateMediaOptions) {
  registerPrivateMediaRoutes(app, options, "video");
  registerPrivateMediaRoutes(app, options, "image");
}

function registerPrivateMediaRoutes(app: FastifyInstance, options: PrivateMediaOptions, kind: "image" | "video") {
  const bucket = kind === "video" ? "private-video" : "private-try-on";
  const root = "/api/assets/" + bucket;
  const label = kind === "video" ? "Video export" : "试穿结果";
  let active = 0;
  app.get(root + "/chat-sessions", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const { rows } = await options.db.query<{ id: string; title: string; canvas_name: string; canvas_id: string }>(
        `select cs.id,cs.title,c.name as canvas_name,c.id as canvas_id
         from chat_sessions cs join canvases c on c.id=cs.canvas_id
         join projects p on p.id=c.project_id
         join workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=$1
         where cs.created_by=$1 and p.workspace_id=$2 and p.archived_at is null
         order by cs.updated_at desc limit 50`, [user.id, viewer.workspace.id],
      );
      return { ok: true, sessions: rows.map((row) => ({ id: row.id, title: row.title, canvasName: row.canvas_name, canvasId: row.canvas_id })) };
    } catch (error) {
      request.log.error({ err: error }, "video chat sessions lookup failed");
      return reply.code(500).send({ error: { code: "sessions_failed", message: "Could not load chat sessions." } });
    }
  });
  app.post(root, async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    const uploadId = request.headers["idempotency-key"];
    if (typeof uploadId !== "string" || !UUID.test(uploadId)) return reply.code(400).send({ error: { code: "invalid_upload_id", message: "A UUID idempotency key is required." } });
    if (active >= MAX_CONCURRENT_UPLOADS) return reply.code(429).send({ error: { code: "upload_busy", message: "Too many video uploads. Try again shortly." } });
    active += 1;
    try {
      const file = await request.file({ limits: { fileSize: kind === "video" ? MAX_VIDEO_BYTES : 25 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
      const types = kind === "video" ? ["video/mp4", "video/webm"] : ["image/png", "image/jpeg", "image/webp"];
      if (!file || !types.includes(file.mimetype)) {
        return reply.code(400).send({ error: { code: `invalid_${kind}`, message: kind === "video" ? "请选择 MP4 或 WebM 视频。" : "请选择 PNG、JPEG 或 WebP 图像。" } });
      }
      const bytes = await file.toBuffer();
      if (kind === "video" && !isVideo(bytes, file.mimetype)) return reply.code(400).send({ error: { code: "invalid_video", message: "The file does not match its video format." } });
      if (kind === "image") {
        const metadata = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata().catch(() => null);
        if (!metadata || `image/${metadata.format}` !== file.mimetype) return reply.code(400).send({ error: { code: "invalid_image", message: "请选择有效的 PNG、JPEG 或 WebP 图像。" } });
      }
      const viewer = await options.viewerService.ensureViewer(user);
      const input = { workspaceId: viewer.workspace.id, userId: user.id, uploadId, bytes };
      const saved = kind === "video"
        ? await savePrivateVideo(options.db, options.storage, { ...input, filename:file.filename, mimeType: file.mimetype as "video/mp4" | "video/webm" })
        : await savePrivateImage(options.db, options.storage, { ...input, mimeType: file.mimetype as "image/png" | "image/jpeg" | "image/webp" });
      return reply.code(saved.created ? 201 : 200).send({ ok: true, assetId: saved.assetId, url: `/api/uploads/${saved.assetId}/file`, created: saved.created });
    } catch (error) {
      if (error instanceof PrivateVideoConflict) return reply.code(409).send({ error: { code: "upload_conflict", message: error.message } });
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: { code: `${kind}_too_large`, message: kind === "video" ? "视频超过 250 MB 上限。" : "图片超过 25 MB 上限。" } });
      request.log.error({ err: error }, "private video upload failed");
      return reply.code(500).send({ error: { code: "upload_failed", message: "无法保存素材。本机文件仍保留，可重试上传。" } });
    } finally {
      active -= 1;
    }
  });

  app.post<{ Params: { assetId: string }; Body: { sessionId?: unknown } }>(root + "/:assetId/send-to-chat", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    const { assetId } = request.params;
    const sessionId = request.body?.sessionId;
    if (!UUID.test(assetId) || typeof sessionId !== "string" || !UUID.test(sessionId)) {
      return reply.code(400).send({ error: { code: "invalid_request", message: "Valid asset and session identifiers are required." } });
    }
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const block = JSON.stringify([{ type: "tool", toolCallId: `${kind === "video" ? "video-export" : "try-on"}:${assetId}`, toolName: kind === "video" ? "video_export" : "fashion_try_on", status: "completed", output: { assetId }, outputSummary: label }]);
      const { rows } = await options.db.query<{ eligible: boolean; message_id: string | null }>(
        `with eligible as materialized (
           select cs.id from chat_sessions cs
           join canvases c on c.id=cs.canvas_id
           join projects p on p.id=c.project_id
           join workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=$3
           join asset_objects ao on ao.id=$1 and ao.workspace_id=p.workspace_id and ao.created_by=$3 and ao.bucket=$7
           join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
           where cs.id=$2 and cs.created_by=$3 and p.workspace_id=$4 and p.archived_at is null
             and ga.created_by=$3 and ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()
         ), written as (
           insert into chat_messages(session_id,role,content,content_blocks,client_message_id)
           select id,'assistant','',$5::jsonb,$6 from eligible
           on conflict (session_id,client_message_id) do update set client_message_id=excluded.client_message_id
             where chat_messages.role=excluded.role and chat_messages.content_blocks=excluded.content_blocks
           returning id
         ) select exists(select 1 from eligible) as eligible, (select id from written) as message_id`,
        [assetId, sessionId, user.id, viewer.workspace.id, block, `${kind === "video" ? "video-export" : "try-on"}:${assetId}`, bucket],
      );
      if (!rows[0]?.eligible) return reply.code(404).send({ error: { code: "not_found", message: "Video or chat session is unavailable." } });
      if (!rows[0].message_id) return reply.code(409).send({ error: { code: "message_conflict", message: "The chat message identifier is already in use." } });
      return reply.send({ ok: true, messageId: rows[0].message_id });
    } catch (error) {
      request.log.error({ err: error }, "video chat delivery failed");
      return reply.code(500).send({ error: { code: "delivery_failed", message: "Could not send the video to chat." } });
    }
  });
}
