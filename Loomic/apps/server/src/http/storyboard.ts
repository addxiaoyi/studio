import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";
import {
  StoryboardServiceError,
  type createLocalStoryboardService,
} from "../local-db/storyboard-service.js";

const assetSchema = z.object({
  kind: z.enum(["character", "scene", "prop"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional(),
  imageUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const storyboardSchema = z.object({
  sceneNo: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  script: z.string().max(10000).optional(),
  shotPrompt: z.string().max(10000).optional(),
  status: z
    .enum(["draft", "queued", "generating", "ready", "failed"])
    .optional(),
  imageAssetId: z.string().uuid().nullable().optional(),
  videoAssetId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function registerStoryboardRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    service: ReturnType<typeof createLocalStoryboardService>;
  },
) {
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/story-assets",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            });
        return reply.send({
          assets: await options.service.listAssets(
            user,
            request.params.projectId,
          ),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/story-assets",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            });
        return reply
          .code(201)
          .send({
            asset: await options.service.createAsset(
              user,
              request.params.projectId,
              assetSchema.parse(request.body),
            ),
          });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.patch<{ Params: { projectId: string; assetId: string } }>(
    "/api/projects/:projectId/story-assets/:assetId",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            });
        return reply.send({
          asset: await options.service.updateAsset(
            user,
            request.params.projectId,
            request.params.assetId,
            assetSchema.parse(request.body),
          ),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.delete<{ Params: { projectId: string; assetId: string } }>(
    "/api/projects/:projectId/story-assets/:assetId",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            });
        await options.service.deleteAsset(
          user,
          request.params.projectId,
          request.params.assetId,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/storyboards",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            });
        return reply.send({
          storyboards: await options.service.listStoryboards(
            user,
            request.params.projectId,
          ),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/storyboards",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            });
        return reply.send({
          storyboard: await options.service.upsertStoryboard(
            user,
            request.params.projectId,
            storyboardSchema.parse(request.body),
          ),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}

function sendError(
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof z.ZodError)
    return reply
      .code(400)
      .send({
        error: {
          code: "invalid_request",
          message: "请求参数不合法",
          issues: error.issues,
        },
      });
  if (error instanceof StoryboardServiceError)
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  console.error("[storyboard] request failed", error);
  return reply
    .code(500)
    .send({
      error: { code: "storyboard_failed", message: "创作数据处理失败" },
    });
}
