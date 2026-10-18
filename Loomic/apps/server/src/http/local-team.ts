import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../auth/types.js";

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
  app.post("/api/workspaces/members/invite", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Missing or invalid session." } });
    const viewer = await options.viewerService.ensureViewer(user); const body = request.body as { email?: string }; const email = body.email?.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效邮箱。" } });
    const member = await options.db.query("select role from workspace_members where workspace_id=$1 and user_id=$2", [viewer.workspace.id, user.id]);
    if (!['owner','admin'].includes(member.rows[0]?.role)) return reply.code(403).send({ error: { code: "forbidden", message: "仅管理员可邀请成员。" } });
    const target = await options.db.query("select id, coalesce(display_name, split_part(email,'@',1)) as name, email from app_users where lower(email)=lower($1)", [email]);
    if (!target.rows[0]) return reply.code(404).send({ error: { code: "user_not_found", message: "该邮箱尚未注册，请先注册账号。" } });
    await options.db.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'member') on conflict (workspace_id,user_id) do nothing", [viewer.workspace.id, target.rows[0].id]);
    return reply.send({ ok: true, member: { ...target.rows[0], role: "member", status: "active" } });
  });
}
