import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { libraryBodySchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { StorageProvider } from "../storage/storage-provider.js";
import { CreativeLibraryService } from "../features/canvas-workflows/library.js";
import { WorkflowError } from "../features/canvas-workflows/service.js";
import {
  workflowResults,
  reuseWorkflowResult,
} from "../features/canvas-workflows/results.js";

export function registerCreativeLibraryRoutes(
  app: FastifyInstance,
  options: { db: Pool; auth: RequestAuthenticator; storage?: StorageProvider },
) {
  const library = new CreativeLibraryService(options.db);
  const params = z.object({
    canvasId: z.string().uuid(),
    id: z.string().uuid().optional(),
    goalId: z.string().uuid().optional(),
  });
  const routes = [
    { method: "GET", url: "/library", action: "list" },
    { method: "POST", url: "/library", action: "save" },
    { method: "DELETE", url: "/library/:id", action: "archive" },
    { method: "POST", url: "/library/:id/restore", action: "restore" },
    { method: "GET", url: "/:id/runs/:goalId/results", action: "results" },
    { method: "POST", url: "/:id/reuse", action: "reuse" },
  ] as const;
  for (const route of routes)
    app.route({
      method: route.method,
      url: `/api/canvases/:canvasId/workflows${route.url}`,
      handler: async (request, reply) => {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              ok: false,
              error: { code: "unauthorized", message: "请先登录。" },
            });
        try {
          const { canvasId, id, goalId } = params.parse(request.params);
          let data: unknown = null;
          if (route.action === "list")
            data = await library.list(user.id, canvasId);
          if (route.action === "save") {
            const body = z
              .object({
                name: z.string().trim().min(1).max(80),
                description: z.string().trim().max(300),
                body: z.unknown(),
                requestKey: z.string().uuid(),
              })
              .strict()
              .parse(request.body);
            data = await library.save(user.id, canvasId, {
              ...body,
              body: libraryBodySchema.parse(body.body),
            });
          }
          if (route.action === "archive" || route.action === "restore")
            await library.archive(
              user.id,
              canvasId,
              id!,
              route.action === "restore",
            );
          if (route.action === "results")
            data = await workflowResults(
              options.db,
              user.id,
              canvasId,
              id!,
              goalId!,
            );
          if (route.action === "reuse") {
            const body = z
              .object({
                goalId: z.string().uuid(),
                nodeId: z.string().min(1).max(64),
                assetId: z.string().uuid().optional(),
              })
              .strict()
              .parse(request.body);
            data = await reuseWorkflowResult(
              options.db,
              options.storage,
              user.id,
              canvasId,
              id!,
              body,
            );
          }
          return reply.send({ ok: true, data });
        } catch (error) {
          if (
            !(error instanceof WorkflowError) &&
            !(error instanceof Error && error.name === "ZodError")
          )
            request.log.error({ err: error }, "Creative library failed");
          return reply
            .code(error instanceof WorkflowError ? error.statusCode : 400)
            .send({
              ok: false,
              error: {
                code: "creative_library_failed",
                message:
                  error instanceof WorkflowError
                    ? error.message
                    : "操作失败，请检查模板内容或稍后重试。",
              },
            });
        }
      },
    });
}
