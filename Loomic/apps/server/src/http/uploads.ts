import type { FastifyInstance, FastifyReply } from "fastify";

import {
  applicationErrorResponseSchemaLoose,
  assetSignedUrlResponseSchema,
  unauthenticatedErrorResponseSchema,
  uploadResponseSchema,
} from "@helstera/shared";

import {
  UploadServiceError,
  type UploadService,
} from "../features/uploads/upload-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../auth/types.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const AUDIO_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/flac"]);
function hasAudioHeader(bytes: Buffer, mime: string) {
  if (bytes.length < 12) return false;
  const head = bytes.toString("ascii", 0, 4);
  if (mime === "audio/wav" || mime === "audio/x-wav") return head === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (mime === "audio/mpeg") return head.startsWith("ID3") || bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  if (mime === "audio/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  return mime === "audio/ogg" ? head === "OggS" : mime === "audio/flac" && head === "fLaC";
}

function inferMimeType(fileName: string): string | null {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  return null;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    uploadService: UploadService;
    viewerService: ViewerService;
  },
) {
  // Upload a file
  app.post<{ Querystring: { purpose?: string } }>("/api/uploads", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthorized(reply);
      if (request.query.purpose && !["try-on", "timeline-audio"].includes(request.query.purpose)) {
        return reply.code(400).send({ error: { code: "invalid_purpose", message: "Unsupported upload purpose." } });
      }

      const file = await request.file({ limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, parts: 2 } });
      if (!file) {
        return reply.code(400).send(
          applicationErrorResponseSchemaLoose.parse({
            error: {
              code: "upload_failed",
              message: "No file provided.",
            },
          }),
        );
      }

      const mimeType = file.mimetype === "application/octet-stream" || !file.mimetype
        ? inferMimeType(file.filename)
        : file.mimetype;
      const audio = request.query.purpose === "timeline-audio";
      if (!mimeType || !(audio ? AUDIO_TYPES : ALLOWED_MIME_TYPES).has(mimeType)) {
        return reply.code(400).send(
          applicationErrorResponseSchemaLoose.parse({
            error: {
              code: "upload_failed",
              message: audio ? "请选择 WAV、MP3、M4A、OGG 或 FLAC 音频。" : "请选择支持的图片文件。",
            },
          }),
        );
      }

      const fileBuffer = await file.toBuffer();
      if (audio && !hasAudioHeader(fileBuffer, mimeType)) return reply.code(400).send({ error: { code: "upload_failed", message: "音频内容与文件格式不符，请重新导出后上传。" } });

      // Resolve workspace from viewer
      const viewer = await options.viewerService.ensureViewer(user);
      const workspaceId = viewer.workspace.id;

      // Extract projectId from fields if provided
      const projectId =
        typeof file.fields.projectId === "object" &&
        file.fields.projectId !== null &&
        "value" in file.fields.projectId
          ? String(file.fields.projectId.value)
          : undefined;

      const result = await options.uploadService.uploadFile(user, {
        bucket: audio ? "private-video" : request.query.purpose === "try-on" ? "private-try-on" : "project-assets",
        fileName: file.filename,
        fileBuffer,
        mimeType,
        workspaceId,
        ...(projectId ? { projectId } : {}),
      });

      return reply
        .code(201)
        .send(uploadResponseSchema.parse(result));
    } catch (error) {
      request.log.error({ err: error }, "media upload failed");
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: { code: "upload_failed", message: "素材不能超过 25 MB。" } });
      return sendUploadError(error, reply);
    }
  });

  // Get signed URL for an asset
  app.get<{ Params: { assetId: string } }>(
    "/api/uploads/:assetId/url",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);

        const url = await options.uploadService.getAssetUrl(
          user,
          request.params.assetId,
        );

        return reply
          .code(200)
          .send(assetSignedUrlResponseSchema.parse({ url }));
      } catch (error) {
        return sendUploadError(error, reply);
      }
    },
  );

  // Delete an asset
  app.delete<{ Params: { assetId: string } }>(
    "/api/uploads/:assetId",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);

        await options.uploadService.deleteAsset(
          user,
          request.params.assetId,
        );

        return reply.code(200).send({ ok: true });
      } catch (error) {
        return sendUploadError(error, reply);
      }
    },
  );
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

function sendUploadError(error: unknown, reply: FastifyReply) {
  if (error instanceof UploadServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  return reply.code(500).send(
    applicationErrorResponseSchemaLoose.parse({
      error: {
        code: "application_error",
        message: "Internal server error.",
      },
    }),
  );
}
