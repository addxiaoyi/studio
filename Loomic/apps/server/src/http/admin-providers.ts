import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { ProviderConfigService } from "../local-db/provider-config-service.js";
import type { RequestAuthenticator } from "../auth/types.js";
import { probeConfiguredModelCalls } from "../local-db/model-call-probe.js";
import { loadModelCallMetrics } from "../local-db/model-call-metrics.js";

async function requireSystemAdmin(
  options: { auth: RequestAuthenticator; db: Pool },
  request: Parameters<RequestAuthenticator["authenticate"]>[0],
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
) {
  const user = await options.auth.authenticate(request);
  if (!user) {
    reply.code(401).send({ error: { code: "unauthorized", message: "请先登录" } });
    return null;
  }
  const { rows } = await options.db.query(
    "select system_role from app_users where id = $1",
    [user.id],
  );
  if (rows[0]?.system_role !== "admin") {
    reply.code(403).send({ error: { code: "forbidden", message: "需要系统管理员权限" } });
    return null;
  }
  return user;
}

export async function registerAdminProviderRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    db: Pool;
    viewerService: ViewerService;
    service: ProviderConfigService;
  },
) {
  app.get("/api/admin/providers", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({
        providers: await options.service.list(user, viewer.workspace.id),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get("/api/admin/model-call-probe", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      return reply.send({ mode: "configuration_only", checkedAt: new Date().toISOString(), models: await probeConfiguredModelCalls(options.db) });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get("/api/admin/model-call-metrics", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const rawHours = Number((request.query as { hours?: string }).hours ?? 24);
      const metrics = await loadModelCallMetrics(options.db, Number.isFinite(rawHours) ? rawHours : 24);
      return reply.send(metrics);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/api/admin/providers", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.code(201).send({
        provider: await options.service.create(
          user,
          viewer.workspace.id,
          request.body as never,
        ),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.put("/api/admin/providers/:id", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({
        provider: await options.service.update(
          user,
          viewer.workspace.id,
          (request.params as { id: string }).id,
          request.body as never,
        ),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.delete("/api/admin/providers/:id", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      await options.service.remove(
        user,
        viewer.workspace.id,
        (request.params as { id: string }).id,
      );
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/api/admin/providers/:id/probe", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({
        provider: await options.service.probe(
          user,
          viewer.workspace.id,
          (request.params as { id: string }).id,
        ),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get("/api/admin/providers/:id/models", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ models: await options.service.listModels(user, viewer.workspace.id, (request.params as { id: string }).id) });
    } catch (error) { return sendError(reply, error); }
  });
  app.put("/api/admin/providers/:id/models/:modelId", async (request, reply) => {
    const user = await requireSystemAdmin(options, request, reply);
    if (!user) return;
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const params = request.params as { id: string; modelId: string };
      return reply.send({ model: await options.service.updateModel(user, viewer.workspace.id, params.id, decodeURIComponent(params.modelId), request.body as never) });
    } catch (error) { return sendError(reply, error); }
  });
}
function sendError(
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  error: unknown,
) {
  const status =
    typeof error === "object" && error && "statusCode" in error
      ? Number((error as { statusCode: number }).statusCode)
      : 500;
  return reply.code(status).send({
    error: {
      code: status === 403 ? "forbidden" : "provider_config_failed",
      message: error instanceof Error ? error.message : "配置操作失败",
    },
  });
}
