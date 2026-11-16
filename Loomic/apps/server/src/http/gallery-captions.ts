import { galleryCaptionsVtt } from "@helstera/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { publishedGallery } from "../features/assets/gallery-service.js";

const identifier = z.string().uuid();
const snapshotSchema = z.object({
  version: z.literal(1),
  language: z.string().regex(/^(?:[a-z]{2,3})(?:-[A-Za-z0-9]{2,8}){0,2}$/),
  label: z.string().trim().min(1).max(60),
  cues: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive().max(7_200_000),
        text: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(2000),
});

export function registerGalleryCaptionRoutes(app: FastifyInstance, db: Pool) {
  app.route<{ Params: { galleryId: string } }>({
    method: ["GET", "HEAD"],
    url: "/api/gallery/:galleryId/captions.vtt",
    handler: async (request, reply) => {
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin");
      const missing = () =>
        reply.code(404).send({
          ok: false,
          error: {
            code: "gallery_caption_not_found",
            message: "公开字幕不存在或已不可用。",
          },
        });
      const id = identifier.safeParse(request.params.galleryId);
      if (!id.success) return missing();
      try {
        const row = (
          await db.query<{ caption_snapshot: unknown }>(
            `select gi.caption_snapshot from gallery_items gi join generated_assets ga on ga.id=gi.asset_id and ga.workspace_id=gi.workspace_id
           where gi.id=$1 and ${publishedGallery} and ga.media_type='video' and gi.caption_snapshot is not null
           and exists(select 1 from asset_objects ao where ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path and ao.created_by=gi.owner_id and ao.mime_type in ('video/mp4','video/webm'))`,
            [id.data],
          )
        ).rows[0];
        if (!row) return missing();
        const parsed = snapshotSchema.parse(row.caption_snapshot);
        let previousEnd = 0;
        for (const cue of parsed.cues) {
          if (cue.startMs < previousEnd || cue.endMs <= cue.startMs)
            throw new Error("Invalid stored caption timing");
          previousEnd = cue.endMs;
        }
        const vtt = galleryCaptionsVtt(parsed);
        reply
          .type("text/vtt; charset=utf-8")
          .header("Content-Length", Buffer.byteLength(vtt));
        return request.method === "HEAD" ? reply.send() : reply.send(vtt);
      } catch (error) {
        request.log.error({ err: error }, "gallery caption lookup failed");
        return reply.code(503).send({
          ok: false,
          error: {
            code: "gallery_caption_unavailable",
            message: "公开字幕暂不可用，请稍后重试。",
          },
        });
      }
    },
  });
}
