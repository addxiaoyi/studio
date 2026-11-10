import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { StorageProvider } from "../storage/storage-provider.js";
import { PrivateVideoConflict } from "../features/assets/private-video.js";
import { VideoUploads, VideoUploadError, VIDEO_CHUNK_BYTES, videoUploadSchema } from "../features/assets/video-upload.js";

export async function registerVideoUploadRoutes(app: FastifyInstance, options: { db: Pool; storage: StorageProvider; root: string; auth: RequestAuthenticator; viewerService: ViewerService }) {
  const uploads = new VideoUploads(options.db, options.storage, `${options.root}.video-uploads`);
  const cleanup = () => uploads.cleanup().catch(err => app.log.error({ err }, "video upload cleanup failed"));
  const timer = setInterval(() => void cleanup(), 60 * 60_000); timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
  await app.register(async scope => {
    scope.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: VIDEO_CHUNK_BYTES }, (_request, body, done) => done(null, body));
    scope.route<{ Params: { uploadId: string } }>({
      method: ["PUT", "PATCH", "POST", "DELETE"], url: "/api/assets/private-video/uploads/:uploadId", bodyLimit: VIDEO_CHUNK_BYTES,
      onRequest: async (request, reply) => {
        if (!await options.auth.authenticate(request)) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录。" } });
      },
      handler: async (request, reply) => {
        const user = await options.auth.authenticate(request);
        if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录。" } });
        const parsedId = z.string().uuid().safeParse(request.params.uploadId);
        if (!parsedId.success) return reply.code(400).send({ ok: false, error: { code: "invalid_upload", message: "上传标识无效。" } });
        try {
          const viewer = await options.viewerService.ensureViewer(user), owner = { userId: user.id, workspaceId: viewer.workspace.id }, id = parsedId.data;
          if (request.method === "DELETE") { await uploads.cancel(owner, id); return { ok: true }; }
          if (request.method === "PUT") {
            const parsed = videoUploadSchema.safeParse(request.body);
            if (!parsed.success) throw new VideoUploadError("请选择不超过 2 GiB 的 MP4 或 WebM 文件。");
            return { ok: true, data: await uploads.begin(owner, id, parsed.data) };
          }
          if (request.method === "POST") return { ok: true, data: await uploads.complete(owner, id) };
          if (!Buffer.isBuffer(request.body) || !/^[a-f0-9]{64}$/.test(String(request.headers["upload-checksum"] ?? "")) || !/^\d+$/.test(String(request.headers["upload-offset"] ?? ""))) throw new VideoUploadError("分片参数无效。");
          return { ok: true, data: await uploads.append(owner, id, Number(request.headers["upload-offset"]), String(request.headers["upload-checksum"]), request.body) };
        } catch (error) {
          request.log.error({ err: error }, "resumable video upload failed");
          return reply.code(error instanceof VideoUploadError ? error.status : error instanceof PrivateVideoConflict ? 409 : 500).send({ ok: false, error: { code: "video_upload_failed", message: error instanceof VideoUploadError || error instanceof PrivateVideoConflict ? error.message : "上传失败，已接收的片段保留，可继续上传。" } });
        }
      },
    });
  });
}
