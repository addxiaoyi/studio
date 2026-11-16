import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

type TaskOptions = {
  auth: RequestAuthenticator;
  db: Pool;
  viewerService: ViewerService;
};

type TaskRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  job_type: string;
  status: string;
  payload: unknown;
  result: unknown;
  error_code: string | null;
  error_message: string | null;
  created_at: unknown;
  completed_at: unknown;
};

const taskIdSchema = z.string().uuid();
const taskColumns = `id,workspace_id,created_by,job_type,queue_name,status,payload,result,
  project_id,canvas_id,session_id,thread_id,progress,stage,attempt_count,max_attempts,
  error_code,error_message,created_at,updated_at,started_at,completed_at,failed_at,
  canceled_at,cancel_requested_at,billing_receipt,billing_pricing,settlement_review,
  sync_attempt_count,next_sync_at,sync_error_code,sync_error_message`;

function failure(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ ok: false, error: { code, message } });
}

async function recoveryFor(db: Pool, task: TaskRow) {
  const statusUrl = `/api/jobs/${task.id}`;
  if (
    task.job_type === "image_generation" ||
    task.job_type === "video_generation"
  ) {
    if (task.status === "sync_failed" || task.status === "sync_pending") {
      return { method: "POST", path: `${statusUrl}/sync`, statusUrl };
    }
    return {
      method: "POST",
      path: `/api/jobs/${task.job_type === "image_generation" ? "image-generation" : "video-generation"}`,
      requiresNewRequest: true,
      requiresCostReview: true,
      statusUrl,
    };
  }
  if (task.job_type === "website_capture") {
    const capture = (
      await db.query<{ id: string }>(
        `select id from website_capture_tasks where background_job_id=$1
       and workspace_id=$2 and created_by=$3`,
        [task.id, task.workspace_id, task.created_by],
      )
    ).rows[0];
    if (capture)
      return {
        method: "POST",
        path: `/api/website-capture/${capture.id}/retry`,
        statusUrl,
      };
  }
  if (task.job_type === "feed_structure") {
    const run = (
      await db.query<{ id: string }>(
        `select id from feed_automation_runs where structure_job_id=$1
       and workspace_id=$2 and created_by=$3 order by created_at desc limit 1`,
        [task.id, task.workspace_id, task.created_by],
      )
    ).rows[0];
    if (run)
      return {
        method: "POST",
        path: `/api/feed/automation/${run.id}/retry`,
        statusUrl,
      };
  }
  return { statusUrl };
}

export function registerLegacyTaskRoutes(
  app: FastifyInstance,
  options: TaskOptions,
) {
  async function loadTask(
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply,
  ) {
    const user = await options.auth.authenticate(request);
    if (!user) {
      failure(reply, 401, "unauthorized", "请先登录。");
      return null;
    }
    const parsed = taskIdSchema.safeParse(request.params.jobId);
    if (!parsed.success) {
      failure(reply, 400, "invalid_task_id", "任务标识无效。");
      return null;
    }
    const viewer = await options.viewerService.ensureViewer(user);
    const task = (
      await options.db.query<TaskRow>(
        `select ${taskColumns} from background_jobs where id=$1 and workspace_id=$2 and created_by=$3`,
        [parsed.data, viewer.workspace.id, user.id],
      )
    ).rows[0];
    if (!task) {
      failure(reply, 404, "task_not_found", "任务不存在或无权访问。");
      return null;
    }
    return task;
  }

  app.get<{ Params: { jobId: string } }>(
    "/api/tasks/:jobId",
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const task = await loadTask(request, reply);
        if (!task) return;
        return { ok: true, data: task };
      } catch (error) {
        request.log.error({ err: error }, "legacy task read failed");
        return failure(
          reply,
          500,
          "task_query_failed",
          "任务读取失败，请稍后重试。",
        );
      }
    },
  );

  app.post<{ Params: { jobId: string } }>(
    "/api/tasks/:jobId/retry",
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const task = await loadTask(request, reply);
        if (!task) return;
        if (
          !["failed", "dead_letter", "sync_failed", "sync_pending"].includes(
            task.status,
          )
        ) {
          return failure(
            reply,
            409,
            "task_not_retryable",
            "任务当前不可重试，请先核对任务状态。",
          );
        }
        // Resetting a shared queue row would bypass its billing and workflow approvals.
        return reply.code(409).send({
          ok: false,
          error: {
            code: "task_recovery_required",
            message:
              "请从原生成或工作流入口恢复，并核对费用与审批；此入口不会重新执行任务。",
          },
          recovery: await recoveryFor(options.db, task),
        });
      } catch (error) {
        request.log.error({ err: error }, "legacy task recovery lookup failed");
        return failure(
          reply,
          500,
          "task_query_failed",
          "任务恢复信息读取失败，请稍后重试。",
        );
      }
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/api/tasks/:jobId/export",
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const task = await loadTask(request, reply);
        if (!task) return;
        const exported = {
          id: task.id,
          status: task.status,
          payload: task.payload,
          result: task.result,
          error_code: task.error_code,
          error_message: task.error_message,
          created_at: task.created_at,
          completed_at: task.completed_at,
        };
        reply
          .header(
            "Content-Disposition",
            `attachment; filename=task-${task.id}.json`,
          )
          .type("application/json");
        return reply.send(JSON.stringify(exported, null, 2));
      } catch (error) {
        request.log.error({ err: error }, "legacy task export failed");
        return failure(
          reply,
          500,
          "task_query_failed",
          "任务导出失败，请稍后重试。",
        );
      }
    },
  );
}
