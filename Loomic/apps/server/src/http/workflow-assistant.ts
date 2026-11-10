import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ServerEnv } from "../config/env.js";
import type { SettingsService } from "../features/settings/settings-service.js";
import type { WorkflowAssistantPlan } from "@helstera/shared";
import { WorkflowAssistantService } from "../features/canvas-workflows/assistant.js";
import { planWorkflowConversation } from "../features/canvas-workflows/assistant-planner.js";
import { workflowReferences } from "../features/canvas-workflows/references.js";
import { listHealthyModels } from "./model-availability.js";
import { WorkflowError } from "../features/canvas-workflows/service.js";
const askSchema = z
  .object({
    prompt: z.string().trim().min(1).max(3000),
    requestKey: z.string().uuid(),
    workflowId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    selectedNodeIds: z.array(z.string().max(64)).max(64).default([]),
    referenceElementIds: z.array(z.string().max(200)).max(12).default([]),
  })
  .strict();
export type WorkflowAssistantOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  env: ServerEnv;
  settingsService: SettingsService;
  enabled?: () => boolean;
  assistantPlan?:
    | ((prompt: string, context: unknown) => Promise<WorkflowAssistantPlan>)
    | undefined;
};
export function registerWorkflowAssistantRoutes(
  app: FastifyInstance,
  options: WorkflowAssistantOptions,
) {
  const service = new WorkflowAssistantService(options.db),
    enabled =
      options.enabled ?? (() => process.env.HELSTERA_GOAL_STEPS === "1");
  for (const operation of [
    "list",
    "ask",
    "get",
    "confirm",
    "reject",
  ] as const) {
    app.route<{ Params: { canvasId: string; id?: string } }>({
      method: operation === "list" || operation === "get" ? "GET" : "POST",
      url: `/api/canvases/:canvasId/workflows/assistant${operation === "list" || operation === "ask" ? "" : operation === "get" ? "/:id" : `/:id/${operation}`}`,
      handler: async (request, reply) => {
        const user = await options.auth.authenticate(request);
        if (!user)
          return reply
            .code(401)
            .send({ ok: false, error: { message: "请先登录。" } });
        try {
          const canvasId = z.string().uuid().parse(request.params.canvasId),
            id = request.params.id;
          let data: unknown;
          if (operation === "list") {
            const query = z
              .object({ workflowId: z.string().uuid().optional() })
              .parse(request.query);
            data = await service.list(user.id, canvasId, query.workflowId);
          }
          if (operation === "get")
            data = await service.get(
              user.id,
              canvasId,
              z.string().uuid().parse(id),
            );
          if (operation === "confirm" || operation === "reject")
            data = await service.decide(
              user.id,
              canvasId,
              z.string().uuid().parse(id),
              operation,
              enabled(),
              z.object({budgetCredits:z.number().finite().min(0).max(100000).optional()}).strict().parse(request.body ?? {}).budgetCredits,
            );
          if (operation === "ask") {
            const body = askSchema.parse(request.body),
              context = await service.context(
                user.id,
                canvasId,
                body.workflowId,
              );
            const prior=await service.request(user.id,canvasId,body.requestKey);
            if(prior){if(prior.prompt!==body.prompt)throw new WorkflowError("请求标识已用于其他对话，请重新发送。",409);return reply.send({ok:true,data:prior});}
            const references = await workflowReferences(
              options.db,
              user.id,
              canvasId,
              body.referenceElementIds,
            );
            const history = await service.list(
              user.id,
              canvasId,
              body.workflowId,
            );
            const catalog = options.assistantPlan
              ? []
              : (
                  await Promise.all([
                    listHealthyModels(options.db, "image", {
                      allowUnverified: true,
                    }),
                    listHealthyModels(options.db, "video", {
                      allowUnverified: true,
                    }),
                  ])
                ).flatMap((models, index) =>
                  models
                    .slice(0, 8)
                    .map((model) => ({
                      id: model.model_id,
                      type: index ? "video" : "image",
                      referenceImage: model.supports_input_image,
                      maxDuration: model.max_duration_seconds,
                    })),
                );
            const input = {
              workflow: context.workflow,
              run: context.goal
                ? {
                    id: context.goal.id,
                    status: context.goal.status,
                    steps: context.goal.executionSteps?.map((step) => ({
                      id: step.stepId,
                      title: step.title,
                      state: step.state,
                      error: step.error,
                    })),
                  }
                : null,
              references,
              selectedNodeIds: body.selectedNodeIds.filter((id) =>
                context.workflow?.graph.nodes.some((node) => node.id === id),
              ),
              models: catalog,
              history: history
                .slice(-6)
                .map((item) => ({
                  request: item.prompt,
                  response: item.summary,
                  status: item.status,
                })),
            };
            const plan = options.assistantPlan
              ? await options.assistantPlan(body.prompt, input)
              : await planWorkflowConversation({
                  env: options.env,
                  settings: options.settingsService,
                  user,
                  workspaceId: context.workspaceId,
                  prompt: body.prompt,
                  context: input,
                });
            data = await service.propose(user.id, canvasId, {
              plan,
              prompt: body.prompt,
              requestKey: body.requestKey,
              ...(body.workflowId
                ? {
                    workflowId: body.workflowId,
                    revision: context.workflow!.revision,
                  }
                : {}),
              ...(body.sessionId ? { sessionId: body.sessionId } : {}),
            });
          }
          return reply.send({ ok: true, data });
        } catch (error) {
          return reply
            .code(error instanceof WorkflowError ? error.statusCode : 400)
            .send({
              ok: false,
              error: {
                message:
                  error instanceof z.ZodError
                    ? "AI 工作流参数无效，请重试。"
                    : error instanceof Error
                      ? error.message
                      : "工作流操作失败。",
              },
            });
        }
      },
    });
  }
}
