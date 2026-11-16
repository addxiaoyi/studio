import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { publishedGallery } from "../features/assets/gallery-service.js";
import { parseByteRange } from "./media-byte-range.js";

const galleryId = z.string().uuid();
const mediaTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
]);
type GalleryMedia = {
  bucket: string;
  object_path: string;
  mime_type: string | null;
  media_type: "image" | "video";
};

function inside(root: string, path: string): boolean {
  const difference = relative(root, path);
  return (
    difference !== "" &&
    !isAbsolute(difference) &&
    difference !== ".." &&
    !difference.startsWith(`..${sep}`)
  );
}

function signatureMatches(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (mime === "image/gif")
    return ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  if (mime === "image/avif")
    return (
      bytes.toString("ascii", 4, 8) === "ftyp" &&
      ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))
    );
  if (mime === "video/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  if (mime === "video/webm")
    return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

export function registerGalleryMediaRoutes(
  app: FastifyInstance,
  options: { db: Pool; root: string },
) {
  if (!options.root || !isAbsolute(options.root))
    throw new Error(
      "Gallery media requires an explicit absolute storage root.",
    );
  app.route<{ Params: { galleryId: string } }>({
    method: ["GET", "HEAD"],
    url: "/api/gallery/:galleryId/media",
    handler: async (request, reply) => {
      // Publication can be withdrawn. Never let conditional requests bypass current authorization.
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin");
      const id = galleryId.safeParse(request.params.galleryId);
      const missing = () =>
        reply.code(404).send({
          error: {
            code: "gallery_media_not_found",
            message: "公开媒体不存在或已不可用。",
          },
        });
      if (!id.success) return missing();
      let asset: GalleryMedia | undefined;
      try {
        asset = (
          await options.db.query<GalleryMedia>(
            `select ao.bucket,ao.object_path,ao.mime_type,ga.media_type
          from gallery_items gi join generated_assets ga on ga.id=gi.asset_id and ga.workspace_id=gi.workspace_id and ga.created_by=gi.owner_id
          join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path and ao.created_by=gi.owner_id
          where gi.id=$1 and ${publishedGallery}
            and exists(select 1 from workspace_members wm where wm.workspace_id=gi.workspace_id and wm.user_id=gi.owner_id)`,
            [id.data],
          )
        ).rows[0];
      } catch (error) {
        request.log.error({ err: error }, "gallery media authorization failed");
        return reply.code(503).send({
          error: {
            code: "gallery_media_unavailable",
            message: "公开媒体暂不可用，请稍后重试。",
          },
        });
      }
      if (
        !asset?.mime_type ||
        !mediaTypes.has(asset.mime_type) ||
        !asset.mime_type.startsWith(`${asset.media_type}/`)
      )
        return missing();
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const base = await realpath(options.root);
        const candidate = resolve(base, asset.bucket, asset.object_path);
        if (!inside(base, candidate)) return missing();
        const path = await realpath(candidate);
        if (!inside(base, path)) return missing();
        const pathInfo = await stat(path);
        if (!pathInfo.isFile()) return missing();
        file = await open(path, "r");
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.dev !== pathInfo.dev ||
          info.ino !== pathInfo.ino ||
          info.size !== pathInfo.size ||
          info.mtimeMs !== pathInfo.mtimeMs
        )
          return missing();
        const header = Buffer.alloc(16);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (!signatureMatches(header.subarray(0, bytesRead), asset.mime_type))
          return missing();
        // Derive the validator from the opened file, not a second path lookup which can race replacement.
        const etag = `"${createHash("sha256").update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.birthtimeMs}`).digest("hex")}"`;
        const current = await file.stat();
        if (
          current.size !== info.size ||
          current.mtimeMs !== info.mtimeMs ||
          current.ctimeMs !== info.ctimeMs
        )
          return missing();
        reply
          .type(asset.mime_type)
          .header("ETag", etag)
          .header("Accept-Ranges", "bytes");
        const range =
          !request.headers["if-range"] || request.headers["if-range"] === etag
            ? request.headers.range
            : undefined;
        const selected = range ? parseByteRange(range, info.size) : null;
        if (range && !selected)
          return reply
            .header("Content-Range", `bytes */${info.size}`)
            .code(416)
            .send();
        const start = selected?.start ?? 0;
        const end = selected?.end ?? info.size - 1;
        if (selected)
          reply
            .code(206)
            .header("Content-Range", `bytes ${start}-${end}/${info.size}`);
        reply.header("Content-Length", end - start + 1);
        if (request.method === "HEAD") return reply.send();
        const stream = file.createReadStream({ start, end, autoClose: true });
        file = undefined;
        reply.raw.once("close", () => stream.destroy());
        return reply.send(stream);
      } catch (error) {
        request.log.warn(
          { kind: error instanceof Error ? error.name : "UnknownError" },
          "gallery media file unavailable",
        );
        return missing();
      } finally {
        await file?.close();
      }
    },
  });
}
