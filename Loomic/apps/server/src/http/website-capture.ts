import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { createWebsiteCaptureRequestSchema, type WebsiteCaptureTask } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { validatePublicHttpUrl, WebsiteCaptureError } from "../features/website-capture/isolated-browser.js";
import type { JobService } from "../features/jobs/job-service.js";

type WebsiteCaptureRouteOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  jobService: JobService;
};

type TaskRow = {
  id: string;
  background_job_id: string | null;
  status: WebsiteCaptureTask["status"];
  mode: WebsiteCaptureTask["mode"];
  start_url: string;
  progress: number;
  stage: string;
  result: WebsiteCaptureTask["result"];
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export function registerWebsiteCaptureRoutes(app: FastifyInstance, options: WebsiteCaptureRouteOptions) {
  app.post("/api/website-capture", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const input = createWebsiteCaptureRequestSchema.parse(request.body);
      if (input.mode === "local") {
        return reply.code(422).send({
          ok: false,
          error: { code: "local_assistant_unavailable", message: "本地浏览器助手尚未连接，请先完成一次性隔离浏览，或连接本地助手后重试。" },
        });
      }
      const viewer = await options.viewerService.ensureViewer(user);
      const startUrl = await validatePublicHttpUrl(input.url);
      const inserted = await options.db.query<TaskRow>(
        `insert into website_capture_tasks
          (workspace_id, created_by, session_id, mode, start_url, page_limit, record_video, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (created_by, idempotency_key) do nothing
         returning id, background_job_id, status, mode, start_url, progress, stage, result,
                   error_message, created_at, updated_at`,
        [viewer.workspace.id, user.id, input.sessionId ?? null, input.mode, startUrl.toString(), input.pageLimit, input.recordVideo, input.idempotencyKey],
      );
      const task = inserted.rows[0] ?? (await options.db.query<TaskRow>(
        `select id, background_job_id, status, mode, start_url, progress, stage, result,
                error_message, created_at, updated_at
           from website_capture_tasks where created_by=$1 and idempotency_key=$2`,
        [user.id, input.idempotencyKey],
      )).rows[0];
      if (!task) return reply.code(500).send({ ok: false, error: { code: "task_create_failed", message: "无法创建网站浏览任务。" } });

      let jobId = task.background_job_id;
      let reused = true;
      if (!jobId && task.status === "queued") {
        try {
          const job = await options.jobService.createJob(user, {
            workspaceId: viewer.workspace.id,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            idempotencyKey: `website-capture:${input.idempotencyKey}`,
            jobType: "website_capture",
            payload: { task_id: task.id },
          });
          jobId = job.id;
          reused = job.reused;
          await options.db.query(
            "update website_capture_tasks set background_job_id=$2, updated_at=now() where id=$1 and background_job_id is null",
            [task.id, job.id],
          );
        } catch (error) {
          await options.db.query("delete from website_capture_tasks where id=$1 and background_job_id is null", [task.id]);
          throw error;
        }
      }
      const current = await loadTask(options.db, task.id, viewer.workspace.id);
      return reply.code(inserted.rows[0] ? 202 : 200).send({ ok: true, data: { task: current, jobId, reused } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.get<{ Params: { taskId: string } }>("/api/website-capture/:taskId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const task = await loadTask(options.db, request.params.taskId, viewer.workspace.id);
      if (!task) return reply.code(404).send({ ok: false, error: { code: "task_not_found", message: "网站浏览任务不存在。" } });
      const events = await options.db.query("select id, stage, detail, created_at from website_capture_events where task_id=$1 order by id", [task.id]);
      return reply.send({ ok: true, data: { task, events: events.rows } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.post<{ Params: { taskId: string } }>("/api/website-capture/:taskId/cancel", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const updated = await options.db.query<TaskRow>(
        `update website_capture_tasks set status='canceled', stage='canceled', error_message=null, updated_at=now()
          where id=$1 and workspace_id=$2 and created_by=$3 and status in ('queued','running')
          returning id, background_job_id, status, mode, start_url, progress, stage, result, error_message, created_at, updated_at`,
        [request.params.taskId, viewer.workspace.id, user.id],
      );
      if (!updated.rows[0]) return reply.code(409).send({ ok: false, error: { code: "task_not_cancelable", message: "任务不存在或已经结束。" } });
      const jobId = updated.rows[0].background_job_id;
      if (jobId) await options.db.query("update background_jobs set status='canceled', canceled_at=now(), updated_at=now() where id=$1 and status in ('queued','running')", [jobId]);
      await options.db.query("insert into website_capture_events(task_id, stage, detail) values($1,'canceled','用户取消了网站浏览任务')", [request.params.taskId]);
      return reply.send({ ok: true, data: { task: toTask(updated.rows[0]) } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.post<{ Params: { taskId: string } }>("/api/website-capture/:taskId/retry", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const found = await options.db.query<{ id: string; background_job_id: string | null }>(
        "select id, background_job_id from website_capture_tasks where id=$1 and workspace_id=$2 and created_by=$3 and status='failed'",
        [request.params.taskId, viewer.workspace.id, user.id],
      );
      const row = found.rows[0];
      if (!row?.background_job_id) return reply.code(409).send({ ok: false, error: { code: "task_not_retryable", message: "任务不存在或当前不可重试。" } });
      await options.db.query("update website_capture_tasks set status='queued', progress=0, stage='queued', error_message=null, updated_at=now() where id=$1", [row.id]);
      await options.jobService.retryJob(user, row.background_job_id);
      await options.db.query("insert into website_capture_events(task_id, stage, detail) values($1,'queued','用户请求重试')", [row.id]);
      const task = await loadTask(options.db, row.id, viewer.workspace.id);
      return reply.send({ ok: true, data: { task } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });
}

async function loadTask(db: Pool, taskId: string, workspaceId: string): Promise<WebsiteCaptureTask | null> {
  const { rows } = await db.query<TaskRow>(
    `select id, background_job_id, status, mode, start_url, progress, stage, result,
            error_message, created_at, updated_at
       from website_capture_tasks where id=$1 and workspace_id=$2`,
    [taskId, workspaceId],
  );
  return rows[0] ? toTask(rows[0]) : null;
}

function toTask(row: TaskRow): WebsiteCaptureTask {
  return {
    id: row.id,
    backgroundJobId: row.background_job_id,
    status: row.status,
    mode: row.mode,
    startUrl: row.start_url,
    progress: Number(row.progress),
    stage: row.stage,
    result: row.result,
    error: row.error_message,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Authentication required." } });
}

function sendWebsiteCaptureError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "网站浏览参数无效。", details: error.issues } });
  if (error instanceof WebsiteCaptureError) return reply.code(400).send({ ok: false, error: { code: error.code, message: error.message } });
  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
  return reply.code(statusCode).send({ ok: false, error: { code: "task_create_failed", message: error instanceof Error ? error.message : "网站浏览任务失败。" } });
}
