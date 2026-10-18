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
    const { rows } = await options.db.query("select bucket, object_path, mime_type from asset_objects where id = $1 and exists (select 1 from workspace_members wm where wm.workspace_id = asset_objects.workspace_id and wm.user_id = $2)", [request.params.assetId, user.id]);
    const asset = rows[0];
    if (!asset) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found." } });
    await options.db.query(
      `update generated_assets set retention_until = now() + interval '30 days', purge_after = null,
              retention_state = 'active', deleted_at = null
       where object_path = (select object_path from asset_objects where id = $1)
         and workspace_id = (select workspace_id from asset_objects where id = $1)`,
      [request.params.assetId],
    );
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
        reply.header("Cache-Control", "private, max-age=86400");
        return reply.send(preview);
      }
      if (wantsPreview && String(asset.mime_type).startsWith("video/")) {
        const { stdout } = await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", filePath,
          "-frames:v", "1", "-vf", "scale=640:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
        reply.type("image/jpeg");
        reply.header("Content-Length", String(stdout.length));
        reply.header("Cache-Control", "private, max-age=86400");
        return reply.send(stdout);
      }
      const fileInfo = await stat(filePath);
      reply.type(asset.mime_type ?? "application/octet-stream");
      reply.header("Content-Length", String(fileInfo.size));
      reply.header("Cache-Control", "private, max-age=300");
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset file not found." } });
    }
  });
}

function isWithin(root: string, filePath: string) {
  const relativePath = relative(resolve(root), filePath);
  return !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

function thumbnailMimeType(filePath: string) {
  return filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/webp";
}
