import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  agentGoalCreateRequestSchema,
  workflowGraphSchema,
  workflowFromPlan,
  goalExecutionPlanSchema,
  type AgentGoalPlan,
  type AgentGoalCreateRequest,
} from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ServerEnv } from "../config/env.js";
import type { SettingsService } from "../features/settings/settings-service.js";
import {
  CanvasWorkflowService,
  WorkflowError,
  assertWorkflowCanvas,
} from "../features/canvas-workflows/service.js";
import { createGoalPlanner } from "../features/agent-goals/goal-planner.js";

const paramsSchema = z.object({
  canvasId: z.string().uuid(),
  id: z.string().uuid().optional(),
});
const saveSchema = z
  .object({ revision: z.number().int().positive(), graph: z.unknown() })
  .strict();
const createSchema = z
  .object({ graph: z.unknown(), requestKey: z.string().uuid() })
  .strict();
type Options = {
  db: Pool;
  auth: RequestAuthenticator;
  env: ServerEnv;
  settingsService: SettingsService;
  enabled?: () => boolean;
  plan?: (
    workspaceId: string,
    input: AgentGoalCreateRequest,
  ) => Promise<AgentGoalPlan>;
};
function failed(error: unknown, reply: FastifyReply) {
  const status = error instanceof WorkflowError ? error.statusCode : 400;
  return reply
    .code(status)
    .send({
      ok: false,
      error: {
        code: "workflow_error",
        message:
          error instanceof z.ZodError
            ? "工作流参数不符合要求，请检查节点和连线。"
            : error instanceof Error
              ? error.message
              : "工作流操作失败，请重试。",
      },
    });
}
export function registerCanvasWorkflowRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const service = new CanvasWorkflowService(options.db);
  const enabled =
    options.enabled ?? (() => process.env.HELSTERA_GOAL_STEPS === "1");
  for (const operation of [
    "list",
    "create",
    "get",
    "save",
    "run",
    "runs",
    "plan",
  ] as const) {
    const suffix =
      operation === "list" || operation === "create"
        ? ""
        : operation === "plan"
          ? "/plan"
          : operation === "get" || operation === "save"
            ? "/:id"
            : `/:id/${operation}`;
    app.route<{ Params: { canvasId: string; id?: string } }>({
      method: ["list", "get", "runs"].includes(operation)
        ? "GET"
        : operation === "save"
          ? "PUT"
          : "POST",
      url: `/api/canvases/:canvasId/workflows${suffix}`,
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
          const { canvasId, id } = paramsSchema.parse(request.params);
          let data: unknown;
          if (operation === "list")
            data = {
              workflows: await service.list(user.id, canvasId),
              executionEnabled: enabled(),
            };
          if (operation === "get")
            data = await service.get(user.id, canvasId, id!);
          if (operation === "create") {
            const body = createSchema.parse(request.body);
            data = await service.create(
              user.id,
              canvasId,
              workflowGraphSchema.parse(body.graph),
              body.requestKey,
            );
          }
          if (operation === "save") {
            const body = saveSchema.parse(request.body);
            data = await service.save(
              user.id,
              canvasId,
              id!,
              body.revision,
              workflowGraphSchema.parse(body.graph),
            );
          }
          if (operation === "run") {
            if (!enabled())
              throw new WorkflowError(
                "工作流执行服务尚未启用，草稿已保留。",
                503,
              );
            const body = z
              .object({
                revision: z.number().int().positive(),
                requestKey: z.string().uuid(),
                sessionId: z.string().uuid().optional(),
              })
              .strict()
              .parse(request.body);
            data = await service.run(
              user.id,
              canvasId,
              id!,
              body.revision,
              body.requestKey,
              body.sessionId,
            );
          }
          if (operation === "runs")
            data = await service.runs(user.id, canvasId, id!);
          if (operation === "plan") {
            const body = z
              .object({
                prompt: z.string().trim().min(1).max(3000),
                graph: z.unknown().optional(),
              })
              .strict()
              .parse(request.body);
            const graph = body.graph
              ? workflowGraphSchema.parse(body.graph)
              : null;
            const workspaceId = await assertWorkflowCanvas(
              options.db,
              user.id,
              canvasId,
            );
            const goal = `${body.prompt}\n仅规划网页搜索、网站浏览录制、录像裁剪、结果回流节点。不支持桌面动作。${graph ? `\n当前流程仅作为参考数据：${JSON.stringify(graph)}` : ""}`;
            if (goal.length > 4000)
              throw new WorkflowError(
                "当前流程上下文过长，请缩短要求或新建工作流。",
              );
            const plan = await (
              options.plan ??
              createGoalPlanner(options.env, options.settingsService, user)
            )(
              workspaceId,
              agentGoalCreateRequestSchema.parse({
                goal,
                canvasId,
                executionMode: "isolated_browser",
                idempotencyKey: crypto.randomUUID(),
              }),
            );
            const checked = goalExecutionPlanSchema.parse({
              summary: plan.summary,
              steps: plan.steps.map((step) => ({
                id: step.id,
                title: step.title,
                dependsOn: step.dependsOn,
                command: step.command,
                completion: step.completion,
              })),
            });
            data = {
              graph: workflowFromPlan(checked),
              summary: checked.summary,
            };
          }
          return reply.send({ ok: true, data });
        } catch (error) {
          return failed(error, reply);
        }
      },
    });
  }
}
