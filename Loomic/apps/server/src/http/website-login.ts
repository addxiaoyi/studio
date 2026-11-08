import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { websiteLoginCredentialsSchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { assertConnectorEnabled } from "../features/agent-goals/connector-gate.js";
import { validatePublicHttpUrl } from "../features/website-capture/isolated-browser.js";
import { saveWebsiteLogin, purgeWebsiteLogins } from "../features/website-capture/login-vault.js";
import { revokeWebsiteSession } from "../features/website-capture/saved-login.js";

export function registerWebsiteLoginRoutes(app: FastifyInstance, options: {db: Pool; auth: RequestAuthenticator; viewerService: ViewerService}) {
  const timer = setInterval(() => { void Promise.all([purgeWebsiteLogins(options.db),options.db.query("update website_handoff_commands set ciphertext=null,status='expired' where expires_at<=now() and status in ('pending','claimed')"),options.db.query("update website_browser_sessions set ciphertext=null where expires_at<=now() and ciphertext is not null")]).catch(() => console.error("[website-login] Expired credential cleanup failed")); }, 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.get('/api/website-capture/login-sessions',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const user=await options.auth.authenticate(request);if(!user)return reply.code(401).send({ok:false});
    const viewer=await options.viewerService.ensureViewer(user);await assertConnectorEnabled(options.db,viewer.workspace.id,user.id,'isolated-browser');
    const {rows}=await options.db.query(`select s.id,s.origin,s.expires_at as "expiresAt",s.updated_at as "updatedAt",(select count(*)::int from website_capture_tasks t where t.browser_session_id=s.id and t.status in ('queued','running')) as "activeTasks" from website_browser_sessions s where s.workspace_id=$1 and s.user_id=$2 and s.expires_at>now() and s.ciphertext is not null order by s.updated_at desc`,[viewer.workspace.id,user.id]);
    return {ok:true,data:rows};
  });
  app.delete<{Params:{id:string}}>('/api/website-capture/login-sessions/:id',async(request,reply)=>{
    const user=await options.auth.authenticate(request);if(!user)return reply.code(401).send({ok:false});
    const id=z.string().uuid().parse(request.params.id),viewer=await options.viewerService.ensureViewer(user);
    try{return {ok:true,data:await revokeWebsiteSession(options.db,{workspaceId:viewer.workspace.id,userId:user.id},id)};}catch{return reply.code(404).send({ok:false,error:{code:'session_missing',message:'网站会话不存在或已被清除。'}});}
  });
  app.post("/api/website-capture/login-credentials", {bodyLimit: 8192}, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ok:false,error:{code:"unauthorized",message:"请先登录工作区。"}});
    const parsed = websiteLoginCredentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ok:false,error:{code:"invalid_login",message:"请填写 HTTPS 登录地址、账号密码和登录成功后可见的文字。"}});
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      await assertConnectorEnabled(options.db, viewer.workspace.id, user.id, "isolated-browser");
      await validatePublicHttpUrl(parsed.data.loginUrl);
      const login = await saveWebsiteLogin(options.db, viewer.workspace.id, user.id, parsed.data);
      return reply.code(201).send({ok:true,data:login});
    } catch {
      return reply.code(400).send({ok:false,error:{code:"login_unavailable",message:"暂时无法保存登录凭据，请确认站点为公开 HTTPS 地址且隔离浏览器已启用。"}});
    }
  });
}
