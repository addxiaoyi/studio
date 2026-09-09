import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../supabase/user.js";

export function registerLocalEcomRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; db: Pool },
): void {
  app.get("/api/ecom/jobs", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Missing or invalid session." } });

    const { rows } = await options.db.query(
      `select id, status, product_name, product_description, scene_ids, outputs,
              ratio, created_at, completed_at
         from ecom_jobs
        where user_id = $1
        order by created_at desc
        limit 20`,
      [user.id],
    );

    return reply.send({ jobs: rows.map(mapJob) });
  });
}

function mapJob(row: Record<string, unknown>) {
  const sceneIds = Array.isArray(row.scene_ids) ? row.scene_ids : [];
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  return {
    id: String(row.id),
    status: row.status === "succeeded" ? "completed" : String(row.status ?? "pending"),
    productName: String(row.product_name ?? ""),
    productDescription: row.product_description as string | null,
    sceneCount: sceneIds.length,
    outputCount: outputs.length,
    errorMessage: null,
    outputs,
    ratio: row.ratio as string | null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
  };
}
