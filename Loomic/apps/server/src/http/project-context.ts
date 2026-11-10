import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { projectContextQuerySchema, projectContextUpdateSchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import { loadProjectContext, ProjectContextError, saveProjectContext } from "../features/projects/project-context.js";

export function registerProjectContextRoutes(app: FastifyInstance, options: { db: Pool; auth: RequestAuthenticator }) {
  app.route({
    method: ["GET", "PUT"], url: "/api/project-context", bodyLimit: 4096,
    async handler(request, reply) {
      const user = await options.auth.authenticate(request);
      if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录。" } });
      const parsed = request.method === "GET" ? projectContextQuerySchema.safeParse(request.query) : projectContextUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "invalid_project_context", message: "工程位置参数无效，请从工程列表重新打开。" } });
      try {
        const context = "expectedRevision" in parsed.data
          ? await saveProjectContext(options.db,user.id,parsed.data)
          : await loadProjectContext(options.db,user.id,parsed.data);
        return reply.header("Cache-Control", "private, no-store").send({ ok: true, data: context });
      } catch (error) {
        if (!(error instanceof ProjectContextError)) request.log.error({ err: error }, "Project context could not be recovered");
        return reply.code(error instanceof ProjectContextError ? error.status : 500).send({ ok: false, error: {
          code: error instanceof ProjectContextError ? error.code : "project_context_failed",
          message: error instanceof ProjectContextError ? error.message : "暂时无法读取工程位置，本机内容仍保留，请重试。",
        } });
      }
    },
  });
}
