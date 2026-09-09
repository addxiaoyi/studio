import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../supabase/user.js";

export function registerLocalAssetRoutes(app: FastifyInstance, options: { db: Pool; auth: RequestAuthenticator; root: string }) {
  app.get<{ Params: { assetId: string } }>("/api/uploads/:assetId/file", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const { rows } = await options.db.query("select object_path, mime_type from asset_objects where id = $1 and exists (select 1 from workspace_members wm where wm.workspace_id = asset_objects.workspace_id and wm.user_id = $2)", [request.params.assetId, user.id]);
    const asset = rows[0];
    if (!asset) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found." } });
    try {
      const filePath = join(options.root, asset.object_path);
      const relativePath = relative(options.root, filePath);
      const outsideRoot = isAbsolute(relativePath) || relativePath.startsWith(".." + sep);
      if (outsideRoot) return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset not found." } });
      await stat(filePath);
      reply.type(asset.mime_type ?? "application/octet-stream");
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: { code: "asset_not_found", message: "Asset file not found." } });
    }
  });
}
