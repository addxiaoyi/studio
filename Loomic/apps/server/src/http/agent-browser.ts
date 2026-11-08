import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { agentBrowserControlSchema,websiteHandoffRequestSchema } from "@helstera/shared";
import { queueHandoffInput,handoffReceipt } from "../features/website-capture/handoff-store.js";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { browserViewStore } from "../features/agent-browser/store.js";
import {
  assertConnectorEnabled,
  ConnectorDisabledError,
} from "../features/agent-goals/connector-gate.js";

export function registerAgentBrowserRoutes(
  app: FastifyInstance,
  options: {
    db: Pool;
    auth: RequestAuthenticator;
    viewerService: ViewerService;
    storageRoot: string;
    enabled: boolean;
  },
) {
  const store = browserViewStore(options.db, options.storageRoot);
  const owners = new WeakMap<
    FastifyRequest,
    { userId: string; workspaceId: string }
  >();
  app.register(async (scope) => {
    scope.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const user = await options.auth.authenticate(request);
      if (!user)
        return reply
          .code(401)
          .send({
            ok: false,
            error: { code: "unauthorized", message: "请先登录。" },
          });
      if (!options.enabled) return;
      const viewer = await options.viewerService.ensureViewer(user);
      await assertConnectorEnabled(
        options.db,
        viewer.workspace.id,
        user.id,
        "isolated-browser",
      );
      owners.set(request, {
        userId: user.id,
        workspaceId: viewer.workspace.id,
      });
    });
    scope.setErrorHandler((error, request, reply) => {
      if (error instanceof z.ZodError)
        return reply
          .code(400)
          .send({
            ok: false,
            error: { code: "invalid_input", message: "浏览器会话参数无效。" },
          });
      if (error instanceof ConnectorDisabledError)
        return reply
          .code(403)
          .send({
            ok: false,
            error: {
              code: "connector_disabled",
              message: "隔离浏览器连接器已禁用。",
            },
          });
      request.log.error({ err: error }, "agent-browser route failed");
      return reply
        .code(500)
        .send({
          ok: false,
          error: {
            code: "browser_view_failed",
            message: "暂时无法读取浏览器画面，请重试。",
          },
        });
    });
    function owner(request: FastifyRequest) {
      const identity = owners.get(request);
      if (!identity) throw new Error("Authenticated browser owner is missing.");
      return identity;
    }
    scope.post('/api/agent/browser/handoff/input',async(request,reply)=>{
      const input=websiteHandoffRequestSchema.parse(request.body);
      try{return {ok:true,data:await queueHandoffInput(options.db,owner(request),input)};}
      catch{return reply.code(409).send({ok:false,error:{code:'handoff_unavailable',message:'登录画面已变化或操作已结束，请刷新画面后重试。'}});}
    });
    scope.get<{Params:{id:string}}>('/api/agent/browser/handoff/receipts/:id',async(request,reply)=>{
      try{return {ok:true,data:await handoffReceipt(options.db,z.string().uuid().parse(request.params.id),owner(request).userId)};}
      catch{return reply.code(404).send({ok:false,error:{code:'receipt_missing',message:'人工操作回执不可用。'}});}
    });
    scope.get("/api/agent/browser/sessions", async (request, reply) =>
      reply.send({
        enabled: options.enabled,
        sessions: options.enabled ? await store.list(await owner(request)) : [],
      }),
    );
    scope.get<{ Params: { id: string } }>(
      "/api/agent/browser/sessions/:id/frame",
      async (request, reply) => {
        const id = z.string().uuid().parse(request.params.id);
        const session = options.enabled
          ? await store.get(id, await owner(request))
          : null;
        if (!session || !session.frameRevision)
          return reply
            .code(404)
            .send({
              ok: false,
              error: {
                code: "frame_missing",
                message: "浏览器画面尚未生成或已过期。",
              },
            });
        try {
          return reply
            .type("image/jpeg")
            .header("X-Frame-Revision", session.frameRevision)
            .send(await store.frame(id));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return reply
              .code(404)
              .send({
                ok: false,
                error: { code: "frame_missing", message: "浏览器画面已过期。" },
              });
          throw error;
        }
      },
    );
    scope.post<{ Params: { id: string } }>(
      "/api/agent/browser/sessions/:id/control",
      async (request, reply) => {
        const id = z.string().uuid().parse(request.params.id),
          parsed = agentBrowserControlSchema.safeParse(request.body);
        if (!parsed.success)
          return reply
            .code(400)
            .send({
              ok: false,
              error: {
                code: "invalid_input",
                message: "请选择暂停或继续浏览。",
              },
            });
        const input = parsed.data;
        if (!options.enabled)
          return reply
            .code(404)
            .send({
              ok: false,
              error: {
                code: "session_missing",
                message: "浏览器预览尚未启用。",
              },
            });
        const identity = await owner(request);
        if (!options.enabled || !(await store.get(id, identity)))
          return reply
            .code(404)
            .send({
              ok: false,
              error: {
                code: "session_missing",
                message: "浏览器会话不存在或已过期。",
              },
            });
        if (!(await store.control(id, identity, input.control)))
          return reply
            .code(409)
            .send({
              ok: false,
              error: {
                code: "session_ended",
                message: "会话已结束或已断线，无法继续操作。",
              },
            });
        return reply.send({ ok: true, session: await store.get(id, identity) });
      },
    );
  });
  if (options.enabled) {
    const prune = () => {
      void store
        .prune()
        .catch((error) =>
          app.log.error({ err: error }, "agent-browser preview cleanup failed"),
        );
    };
    const timer = setInterval(prune, 10 * 60_000);
    timer.unref();
    prune();
    app.addHook("onClose", async () => clearInterval(timer));
  }
}
