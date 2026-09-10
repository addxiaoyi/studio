import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export function registerLocalTeamRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; db: Pool; viewerService: ViewerService },
): void {
  app.get("/api/workspaces/members", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Missing or invalid session." } });
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query(
      `select u.id, coalesce(u.display_name, split_part(u.email, '@', 1)) as name,
              u.email, wm.role
         from workspace_members wm
         join app_users u on u.id = wm.user_id
        where wm.workspace_id = $1
        order by case when wm.role = 'owner' then 0 when wm.role = 'admin' then 1 else 2 end, wm.created_at`,
      [viewer.workspace.id],
    );
    return reply.send({ members: rows.map((row) => ({ ...row, status: "active" })) });
  });
}
