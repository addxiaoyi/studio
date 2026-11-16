import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import sharp from "sharp";
import type { RequestAuthenticator } from "../auth/types.js";
import { verifyProviderAssetSignature } from "../features/uploads/provider-asset-url.js";
import { registerLocalCopyRelease } from "./local-copy-release.js";
import { mediaCookie, mediaCookieOwner } from "./media-access.js";
import { parseByteRange } from "./media-byte-range.js";
import { mediaFileVersion } from "./media-file-version.js";
import { MediaPreviewCache } from "./media-preview-cache.js";

const activeAssetSql = `not exists(select 1 from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
    and (ga.deleted_at is not null or ga.retention_state<>'active' or ga.retention_until<=now()))
  and (ao.bucket not in ('private-video','private-try-on')
    or exists(select 1 from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path and ga.retention_until>now())
    or ao.created_at>now()-interval '3 days')`;

export const readableAssetSql = `select ao.bucket, ao.object_path, ao.mime_type, ao.byte_size,
  coalesce((select min(ga.retention_until) from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path), case when ao.bucket in ('private-video','private-try-on') then ao.created_at+interval '3 days' end) as expires_at
  from asset_objects ao where ao.id=$1
  and exists(select 1 from workspace_members wm where wm.workspace_id=ao.workspace_id and wm.user_id=$2)
  and (ao.bucket not in ('private-video','private-try-on') or ao.created_by=$2)
  and ${activeAssetSql}`;

const execFileAsync = promisify(execFile);
const VIDEO_PREVIEW_TIMEOUT_MS = 15_000;

async function createVideoPreview(filePath: string): Promise<{ contentType: "image/jpeg"; bytes: Buffer }> {
  let lastError: unknown = null;
  for (const seek of ["0.5", "0"]) {
    try {
      const { stdout } = await execFileAsync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          seek,
          "-i",
          filePath,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-2",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "pipe:1",
        ],
        {
          encoding: "buffer",
          maxBuffer: 8 * 1024 * 1024,
          timeout: VIDEO_PREVIEW_TIMEOUT_MS,
        },
      );
      if (stdout.length > 0) return { contentType: "image/jpeg", bytes: stdout };
      lastError = new Error("FFmpeg returned an empty preview.");
    } catch (error) {
      lastError = error;
      if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "ENOENT") break;
    }
  }
  throw lastError ?? new Error("Video preview generation failed.");
}

function previewEtag(sourceEtag: string): string {
  return `W/\"preview-${sourceEtag.replaceAll('"', "")}\"`;
}

function previewFailure(error: unknown): { statusCode: 422 | 503; code: string; message: string } {
  const errorCode = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (errorCode === "ENOENT") {
    return { statusCode: 503, code: "preview_runtime_unavailable", message: "预览服务暂时不可用，请稍后重试。" };
  }
  if (typeof error === "object" && error !== null && "killed" in error && error.killed === true) {
    return { statusCode: 503, code: "preview_generation_timeout", message: "预览生成超时，请重试或下载原文件。" };
  }
  return { statusCode: 422, code: "preview_generation_failed", message: "素材预览生成失败，文件可能损坏或格式不受支持。" };
}

function isPrivateAsset(bucket: string): boolean {
  return bucket === "private-video" || bucket === "private-try-on";
}

export function registerLocalAssetRoutes(app: FastifyInstance, options: { db: Pool; auth: RequestAuthenticator; root: string }) {
  const previewCache = new MediaPreviewCache();
  registerLocalCopyRelease(app, options);
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/thumbnail", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });

    const { rows } = await options.db.query<{ workspace_id: string; thumbnail_path: string | null }>(
      `select p.workspace_id, p.thumbnail_path
       from projects p
       join workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = $2
       where p.id = $1 and p.archived_at is null`,
      [request.params.projectId, user.id],
    );
    const project = rows[0];
    if (!project) return reply.code(404).send({ error: { code: "project_not_found", message: "Project not found." } });

    const objectPaths = project.thumbnail_path ? [project.thumbnail_path] : [];
    const candidates = objectPaths.flatMap((objectPath) => [
      resolve(options.root, "project-assets", objectPath),
      resolve(options.root, objectPath),
    ]);

    for (const candidate of candidates) {
      try {
        const { path: filePath, info: fileInfo } = await storedFile(options.root, candidate);
        reply.type(thumbnailMimeType(filePath));
        reply.header("content-length", String(fileInfo.size));
        reply.header("cache-control", "private, max-age=3600");
        reply.header("cross-origin-resource-policy", "same-origin");
        return reply.send(createReadStream(filePath));
      } catch {
        // Try the next storage layout or extension.
      }
    }

    return reply.code(404).send({ error: { code: "thumbnail_not_found", message: "Project preview is not available." } });
  });

  app.get<{ Params: { assetId: string }; Querystring: { expires?: string; signature?: string } }>("/api/provider-assets/:assetId", async (request, reply) => {
    const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    if (!secret || !request.query.expires || !request.query.signature || !verifyProviderAssetSignature({
      assetId: request.params.assetId,
      expiresAt: request.query.expires,
      signature: request.query.signature,
      secret,
    })) {
      return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });
    }

    const asset = await options.db.query<{ bucket: string; object_path: string; mime_type: string | null }>(
      `select ao.bucket,ao.object_path,ao.mime_type from asset_objects ao where ao.id=$1
        and ${activeAssetSql}
        and (ao.bucket not in ('private-video','private-try-on') or exists(
          select 1 from workspace_members wm where wm.workspace_id=ao.workspace_id and wm.user_id=ao.created_by))`,
      [request.params.assetId],
    );
    const row = asset.rows[0];
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });

    try {
      const bucketRoot = resolve(options.root, row.bucket);
      const candidate = resolve(bucketRoot, row.object_path);
      const relativePath = relative(bucketRoot, candidate);
      if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });
      }
      const { path: filePath, info: fileInfo } = await storedFile(options.root, candidate);
      reply.type(row.mime_type ?? "application/octet-stream");
      reply.header("content-length", String(fileInfo.size));
      reply.header("cache-control", "private, no-store");
      reply.header("cross-origin-resource-policy", "cross-origin");
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });
    }
  });

  app.post<{ Params: { assetId: string } }>("/api/uploads/:assetId/playback", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "请先登录。" } });
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(request.params.assetId)) return reply.code(400).send({ error: { code: "invalid_asset", message: "素材标识无效。" } });
    const asset = (await options.db.query(readableAssetSql, [request.params.assetId, user.id])).rows[0];
    if (!asset) return reply.code(404).send({ error: { code: "asset_not_found", message: "素材已到期、已删除或无权访问。" } });
    const path = `/api/uploads/${request.params.assetId}/file`;
    reply.header("Set-Cookie", mediaCookie(request.params.assetId, user.id, request.protocol === "https" || request.headers["x-forwarded-proto"] === "https"));
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, data: { path, mimeType: asset.mime_type, byteSize: Number(asset.byte_size), expiresAt: asset.expires_at ?? null, grantSeconds: 300 } };
  });

  app.get<{ Params: { assetId: string }; Querystring: { preview?: string; download?: string } }>("/api/uploads/:assetId/file", async (request, reply) => {
    const authenticated = await options.auth.authenticate(request);
    const mediaOwner = authenticated ? null : mediaCookieOwner(request.headers.cookie, request.params.assetId);
    const user = authenticated ?? (mediaOwner ? { id: mediaOwner } : null);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const { rows } = await options.db.query(readableAssetSql, [request.params.assetId, user.id]);
    const asset = rows[0];
    if (!asset) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found." } });
    try {
      const bucketPath = join(options.root, asset.bucket, asset.object_path);
      const rootPath = join(options.root, asset.object_path);
      let file: Awaited<ReturnType<typeof storedFile>>;
      try {
        file = await storedFile(options.root, bucketPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        file = await storedFile(options.root, rootPath);
      }
      const { path: filePath, info: fileInfo } = file;
      const wantsPreview = request.query.preview === "1";
      const etag = await mediaFileVersion(filePath);
      const previewKey = `${filePath}:${etag}:${asset.mime_type}`;
      let cachedPreview: { contentType: string; bytes: Buffer } | null = null;
      if (wantsPreview) {
        try {
          cachedPreview = await previewCache.getOrCreate(previewKey, async () => {
            if (String(asset.mime_type).startsWith("image/")) {
              const bytes = await sharp(filePath)
                .rotate()
                .resize(640, 640, { fit: "inside", withoutEnlargement: true })
                .webp({ quality: 78 })
                .toBuffer();
              return { contentType: "image/webp", bytes };
            }

            if (String(asset.mime_type).startsWith("video/")) return createVideoPreview(filePath);
            return null;
          });
        } catch (error) {
          const failure = previewFailure(error);
          reply.header("Cache-Control", "private, no-store");
          reply.header("Vary", "Authorization, Cookie");
          return reply.code(failure.statusCode).send({ error: { code: failure.code, message: failure.message } });
        }
      }
      if (cachedPreview) {
        const previewTag = previewEtag(etag);
        reply.header("ETag", previewTag);
        reply.header("X-Media-Preview", "generated");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Cache-Control", isPrivateAsset(asset.bucket) ? "private, no-store" : "private, max-age=86400");
        reply.header("Vary", "Authorization, Cookie");
        if (request.headers["if-none-match"]?.split(",").map((value) => value.trim()).includes(previewTag)) {
          return reply.code(304).send();
        }
        reply.type(cachedPreview.contentType);
        reply.header("Content-Length", String(cachedPreview.bytes.length));
        return reply.send(cachedPreview.bytes);
      }
      if (wantsPreview) {
        reply.header("Cache-Control", "private, no-store");
        reply.header("Vary", "Authorization, Cookie");
        return reply.code(415).send({ error: { code: "preview_not_supported", message: "该素材类型暂不支持预览。" } });
      }
      reply.type(asset.mime_type ?? "application/octet-stream");
      reply.header("ETag", etag);
      reply.header("X-Content-Type-Options", "nosniff");
      if (request.query.download === "1") {
        const extensions: Record<string, string> = {
          "video/webm": "webm",
          "video/mp4": "mp4",
          "video/ogg": "ogv",
          "video/quicktime": "mov",
          "video/x-matroska": "mkv",
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "audio/mpeg": "mp3",
          "audio/wav": "wav",
        };
        reply.header("Content-Disposition", `attachment; filename="${request.params.assetId.replace(/[^a-zA-Z0-9-]/g, "")}.${extensions[String(asset.mime_type)] ?? "bin"}"`);
      }
      reply.header("Cache-Control", isPrivateAsset(asset.bucket) ? "private, no-store" : "private, max-age=300");
      if (/^(video|audio|image)\//.test(String(asset.mime_type))) {
        reply.header("Accept-Ranges", "bytes");
        const range = !request.headers["if-range"] || request.headers["if-range"] === etag ? request.headers.range : undefined;
        if (range) {
          const selected = parseByteRange(range, fileInfo.size);
          if (!selected) {
            reply.header("Content-Range", `bytes */${fileInfo.size}`);
            return reply.code(416).send();
          }
          reply.code(206);
          reply.header("Content-Range", `bytes ${selected.start}-${selected.end}/${fileInfo.size}`);
          reply.header("Content-Length", String(selected.end - selected.start + 1));
          return reply.send(createReadStream(filePath, selected));
        }
      }
      reply.header("Content-Length", String(fileInfo.size));
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset file not found." } });
    }
  });
}

async function storedFile(root: string, candidate: string) {
  if (!isWithin(root, resolve(candidate))) throw new Error("Asset path is outside storage.");
  const [physicalRoot, physicalFile] = await Promise.all([realpath(root), realpath(candidate)]);
  // Lexical containment alone still follows junctions and symlinks out of storage.
  if (!isWithin(physicalRoot, physicalFile)) throw new Error("Asset link is outside storage.");
  const info = await stat(physicalFile);
  if (!info.isFile()) throw new Error("Asset path is not a file.");
  return { path: physicalFile, info };
}

function isWithin(root: string, filePath: string) {
  const relativePath = relative(resolve(root), filePath);
  return !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

function thumbnailMimeType(filePath: string) {
  return filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/webp";
}
