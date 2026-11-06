import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import sharp from "sharp";
import type { RequestAuthenticator } from "../auth/types.js";
import { verifyProviderAssetSignature } from "../features/uploads/provider-asset-url.js";

const execFileAsync = promisify(execFile);

export function registerLocalAssetRoutes(app: FastifyInstance, options: { db: Pool; auth: RequestAuthenticator; root: string }) {
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

    for (const filePath of candidates) {
      if (!isWithin(options.root, filePath)) continue;
      try {
        const fileInfo = await stat(filePath);
        if (!fileInfo.isFile()) continue;
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
      "select bucket,object_path,mime_type from asset_objects where id=$1",
      [request.params.assetId],
    );
    const row = asset.rows[0];
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });

    try {
      const bucketRoot = resolve(options.root, row.bucket);
      const filePath = resolve(bucketRoot, row.object_path);
      const relativePath = relative(bucketRoot, filePath);
      if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });
      }
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });
      reply.type(row.mime_type ?? "application/octet-stream");
      reply.header("content-length", String(fileInfo.size));
      reply.header("cache-control", "private, max-age=60");
      reply.header("cross-origin-resource-policy", "cross-origin");
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: { code: "not_found", message: "File not found" } });
    }
  });

  app.get<{ Params: { assetId: string }; Querystring: { preview?: string } }>("/api/uploads/:assetId/file", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const { rows } = await options.db.query(`select ao.bucket, ao.object_path, ao.mime_type from asset_objects ao
      where ao.id = $1 and exists (select 1 from workspace_members wm where wm.workspace_id = ao.workspace_id and wm.user_id = $2)
      and (ao.bucket not in ('private-video','private-try-on') or (ao.created_by=$2
        and not exists (select 1 from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
          and (ga.deleted_at is not null or ga.retention_state<>'active' or ga.retention_until<=now()))
        and (exists (select 1 from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path and ga.retention_until>now())
          or ao.created_at > now() - interval '3 days')))`, [request.params.assetId, user.id]);
    const asset = rows[0];
    if (!asset) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found." } });
    try {
      const bucketPath = join(options.root, asset.bucket, asset.object_path);
      const rootPath = join(options.root, asset.object_path);
      let filePath = bucketPath;
      try {
        await stat(bucketPath);
      } catch {
        await stat(rootPath);
        filePath = rootPath;
      }
      const relativePath = relative(options.root, filePath);
      const outsideRoot = isAbsolute(relativePath) || relativePath.startsWith(".." + sep);
      if (outsideRoot) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found." } });
      const wantsPreview = request.query.preview === "1";
      if (wantsPreview && String(asset.mime_type).startsWith("image/")) {
        const preview = await sharp(filePath)
          .rotate()
          .resize(640, 640, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        reply.type("image/webp");
        reply.header("Content-Length", String(preview.length));
        reply.header("Cache-Control", asset.bucket === "private-video" || asset.bucket === "private-try-on" ? "private, no-store" : "private, max-age=86400");
        return reply.send(preview);
      }
      if (wantsPreview && String(asset.mime_type).startsWith("video/")) {
        const { stdout } = await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", filePath,
          "-frames:v", "1", "-vf", "scale=640:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
        reply.type("image/jpeg");
        reply.header("Content-Length", String(stdout.length));
        reply.header("Cache-Control", asset.bucket === "private-video" || asset.bucket === "private-try-on" ? "private, no-store" : "private, max-age=86400");
        return reply.send(stdout);
      }
      const fileInfo = await stat(filePath);
      reply.type(asset.mime_type ?? "application/octet-stream");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", asset.bucket === "private-video" || asset.bucket === "private-try-on" ? "private, no-store" : "private, max-age=300");
      if (String(asset.mime_type).startsWith("video/")) {
        reply.header("Accept-Ranges", "bytes");
        // Without a validator we cannot satisfy If-Range safely; return the full file.
        const range = request.headers["if-range"] ? undefined : request.headers.range;
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

function parseByteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !size || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function isWithin(root: string, filePath: string) {
  const relativePath = relative(resolve(root), filePath);
  return !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

function thumbnailMimeType(filePath: string) {
  return filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/webp";
}
