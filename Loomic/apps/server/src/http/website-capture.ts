import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { createWebsiteCaptureRequestSchema, desktopAgentTaskRequestSchema, type WebsiteCapturePromo, type WebsiteCaptureTask } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { validatePublicHttpUrl, WebsiteCaptureError } from "../features/website-capture/isolated-browser.js";
import { WebsiteAssistantHub, validateLocalExactUrl } from "../features/website-capture/assistant-hub.js";
import { claimWebsiteCaptureRetry } from "../features/website-capture/retry.js";
import type { JobService } from "../features/jobs/job-service.js";
import type { CreditService } from "../features/credits/credit-service.js";
import type { TierGuard } from "../features/credits/tier-guard.js";
import type { createGenerationApprovalService } from "../features/generation/generation-approval-service.js";

type WebsiteCaptureRouteOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  jobService: JobService;
  assistantHub: WebsiteAssistantHub;
  generationApprovalService?: ReturnType<typeof createGenerationApprovalService>;
  creditService?: CreditService;
  tierGuard?: TierGuard;
};

type TaskRow = {
  id: string;
  background_job_id: string | null;
  status: WebsiteCaptureTask["status"];
  mode: WebsiteCaptureTask["mode"];
  start_url: string;
  progress: number;
  stage: string;
  follow_external: boolean;
  assistant_connection_id: string | null;
  promo_status?: WebsiteCaptureTask["promoStatus"];
  promo?: WebsiteCaptureTask["promo"];
  promo_approval_id?: string | null;
  promo_job_id?: string | null;
  promo_video_url?: string | null;
  promo_error?: string | null;
  result: WebsiteCaptureTask["result"];
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export function registerWebsiteCaptureRoutes(app: FastifyInstance, options: WebsiteCaptureRouteOptions) {
  app.post("/api/website-capture/pairings", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await options.assistantHub.createPairing(user.id, viewer.workspace.id) });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.get("/api/website-capture/assistant", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await options.assistantHub.getConnection(user.id, viewer.workspace.id) });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.post("/api/website-capture/assistant/revoke", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      await options.assistantHub.revoke(user.id, viewer.workspace.id);
      return reply.send({ ok: true, data: null });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.post("/api/website-capture/assistant/desktop-tasks", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const input = desktopAgentTaskRequestSchema.parse(request.body);
      const task = await options.assistantHub.createDesktopAgentTask(user.id, viewer.workspace.id, input);
      return reply.code(202).send({ ok: true, data: task });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.get("/api/website-capture/assistant/desktop-tasks", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await options.assistantHub.listDesktopAgentTasks(user.id, viewer.workspace.id) });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.get<{ Params: { taskId: string } }>("/api/website-capture/assistant/desktop-tasks/:taskId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const [task] = await options.assistantHub.listDesktopAgentTasks(user.id, viewer.workspace.id, request.params.taskId);
      if (!task) return reply.code(404).send({ ok: false, error: { code: "desktop_agent_task_not_found", message: "Desktop Agent task not found." } });
      return reply.send({ ok: true, data: task });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.post<{ Params: { taskId: string } }>("/api/website-capture/assistant/desktop-tasks/:taskId/cancel", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await options.assistantHub.cancelDesktopAgentTask(user.id, viewer.workspace.id, request.params.taskId) });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  for (const [decision, operation] of [["approve", "approveDesktopAction"], ["reject", "rejectDesktopAction"]] as const) {
    app.post<{ Params: { approvalId: string } }>(`/api/website-capture/assistant/desktop-approvals/:approvalId/${decision}`, async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      try {
        const viewer = await options.viewerService.ensureViewer(user);
        const result = await options.assistantHub[operation](user.id, viewer.workspace.id, request.params.approvalId);
        return reply.send({ ok: true, data: result });
      } catch (error) {
        return sendWebsiteCaptureError(error, reply);
      }
    });
  }

  for (const [path, paused] of [["/api/website-capture/assistant/pause", true], ["/api/website-capture/assistant/resume", false]] as const) {
    app.post(path, async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      try {
        const viewer = await options.viewerService.ensureViewer(user);
        await options.assistantHub.setUserPaused(user.id, viewer.workspace.id, paused);
        return reply.send({ ok: true, data: await options.assistantHub.getConnection(user.id, viewer.workspace.id) });
      } catch (error) {
        return sendWebsiteCaptureError(error, reply);
      }
    });
  }

  app.post("/api/website-capture", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const input = createWebsiteCaptureRequestSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);
      const startUrl = input.mode === "isolated" ? await validatePublicHttpUrl(input.url) : validateLocalExactUrl(input.url);
      if (input.mode === "local") {
        const connection = await options.assistantHub.getConnection(user.id, viewer.workspace.id);
        if (!connection || connection.status !== "connected") {
          return reply.code(409).send({ ok: false, error: { code: "local_assistant_unavailable", message: "请先连接并授权本地浏览器助手。" } });
        }
        const inserted = await options.db.query<TaskRow>(
          `insert into website_capture_tasks
            (workspace_id, created_by, session_id, mode, start_url, page_limit, record_video, follow_external, assistant_connection_id, promo, idempotency_key)
           values ($1,$2,$3,'local',$4,$5,$6,$7,$8,$9,$10)
           on conflict (workspace_id, created_by, idempotency_key) do nothing
           returning id, background_job_id, status, mode, start_url, page_limit, record_video, progress, stage, result,
                     error_message, created_at, updated_at, follow_external, assistant_connection_id`,
          [viewer.workspace.id, user.id, input.sessionId ?? null, startUrl.toString(), input.pageLimit, input.recordVideo, input.followExternal, connection.id, input.promo?.enabled ? JSON.stringify(input.promo) : null, input.idempotencyKey],
        );
        const task = inserted.rows[0] ?? (await options.db.query<TaskRow>(
          `select id, background_job_id, status, mode, start_url, page_limit, record_video, progress, stage, result,
                  error_message, created_at, updated_at, follow_external, assistant_connection_id
             from website_capture_tasks where workspace_id=$1 and created_by=$2 and idempotency_key=$3`,
          [viewer.workspace.id, user.id, input.idempotencyKey],
        )).rows[0];
        if (!task) return reply.code(500).send({ ok: false, error: { code: "task_create_failed", message: "无法创建本地浏览任务。" } });
        if (task.status === "queued") await options.assistantHub.startLocalTask(task.id, user.id);
        return reply.code(inserted.rows[0] ? 202 : 200).send({ ok: true, data: { task: await loadTask(options.db, task.id, viewer.workspace.id), jobId: null, reused: !inserted.rows[0] } });
      }
      const inserted = await options.db.query<TaskRow>(
        `insert into website_capture_tasks
          (workspace_id, created_by, session_id, mode, start_url, page_limit, record_video, follow_external, promo, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (workspace_id, created_by, idempotency_key) do nothing
         returning id, background_job_id, status, mode, start_url, progress, stage, result,
                   error_message, created_at, updated_at`,
        [viewer.workspace.id, user.id, input.sessionId ?? null, input.mode, startUrl.toString(), input.pageLimit, input.recordVideo, input.followExternal, input.promo?.enabled ? JSON.stringify(input.promo) : null, input.idempotencyKey],
      );
      const task = inserted.rows[0] ?? (await options.db.query<TaskRow>(
          `select id, background_job_id, status, mode, start_url, page_limit, record_video, progress, stage, result,
                error_message, created_at, updated_at, follow_external, assistant_connection_id
           from website_capture_tasks where workspace_id=$1 and created_by=$2 and idempotency_key=$3`,
        [viewer.workspace.id, user.id, input.idempotencyKey],
      )).rows[0];
      if (!task) return reply.code(500).send({ ok: false, error: { code: "task_create_failed", message: "无法创建网站浏览任务。" } });

      let jobId = task.background_job_id;
      let reused = true;
      if (!jobId && task.status === "queued") {
        try {
          const job = await options.jobService.createJob(user, {
            workspaceId: viewer.workspace.id,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            idempotencyKey: `website-capture:${viewer.workspace.id}:${input.idempotencyKey}`,
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
      let task = await loadTask(options.db, request.params.taskId, viewer.workspace.id);
      if (!task) return reply.code(404).send({ ok: false, error: { code: "task_not_found", message: "网站浏览任务不存在。" } });
      if (task.backgroundJobId && (task.status === "queued" || task.status === "running")) {
        const job = (await options.db.query<{ status: string; error_message: string | null }>(
          "select status,error_message from background_jobs where id=$1 and created_by=$2",
          [task.backgroundJobId, user.id],
        )).rows[0];
        if (job && ["failed", "dead_letter"].includes(job.status)) {
          const errorMessage = job.error_message ?? "后台浏览任务已失败，可重试。";
          const failed = await options.db.query<TaskRow>(
            `update website_capture_tasks set status='failed',stage='failed',error_message=$4,updated_at=now()
              where id=$1 and workspace_id=$2 and created_by=$3 and status in ('queued','running')
              returning id,background_job_id,status,mode,start_url,progress,stage,result,error_message,created_at,updated_at`,
            [task.id, viewer.workspace.id, user.id, errorMessage],
          );
          if (failed.rows[0]) {
            await options.db.query("update website_capture_actions set status='expired' where task_id=$1 and status in ('pending','approved')", [task.id]);
            await options.db.query("insert into website_capture_events(task_id,stage,detail) values($1,'failed',$2)", [task.id, errorMessage]);
            task = toTask(failed.rows[0]);
          }
        }
      }
      const events = await options.db.query(
        `select id,stage,detail,created_at from (
           select id,stage,detail,created_at from website_capture_events where task_id=$1 order by id desc limit 100
         ) recent order by id`,
        [task.id],
      );
      const approval = task.promoApprovalId
        ? (await options.db.query<{ id: string; job_type: "video_generation"; model: string; estimated_credits: number; expires_at: string; payload: { duration?: number; resolution?: string; input_asset_ids?: string[] } }>(
            `select id,job_type,model,estimated_credits,expires_at,payload from generation_approvals where id=$1 and workspace_id=$2 and user_id=$3`,
            [task.promoApprovalId, viewer.workspace.id, user.id],
          )).rows[0]
        : null;
      return reply.send({ ok: true, data: { task, events: events.rows, ...(approval ? { promoApproval: { approvalId: approval.id, jobType: approval.job_type, model: approval.model, estimatedCredits: Number(approval.estimated_credits), expiresAt: approval.expires_at, hasReferenceImage: (approval.payload.input_asset_ids?.length ?? 0) > 0, ...(approval.payload.duration !== undefined ? { duration: approval.payload.duration } : {}), ...(approval.payload.resolution ? { resolution: approval.payload.resolution } : {}) } } : {}) } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.get<{ Params: { taskId: string } }>("/api/website-capture/:taskId/actions", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await options.assistantHub.listPendingActions(user.id, viewer.workspace.id, request.params.taskId) });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  for (const [suffix, operation] of [["approve", "approveAction"], ["reject", "rejectAction"]] as const) {
    app.post<{ Params: { actionId: string } }>(`/api/website-capture/actions/:actionId/${suffix}`, async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      try {
        const viewer = await options.viewerService.ensureViewer(user);
        const result = await options.assistantHub[operation](user.id, viewer.workspace.id, request.params.actionId);
        return reply.send({ ok: true, data: result });
      } catch (error) {
        return sendWebsiteCaptureError(error, reply);
      }
    });
  }

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
      await options.db.query("update website_capture_actions set status='expired' where task_id=$1 and status in ('pending','approved')", [updated.rows[0].id]);
      const jobId = updated.rows[0].background_job_id;
      if (jobId) await options.db.query("update background_jobs set status='canceled', canceled_at=now(), updated_at=now() where id=$1 and status in ('queued','running')", [jobId]);
      if (updated.rows[0].mode === "local") await options.assistantHub.revokeTask(updated.rows[0].id);
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
      let taskRow: { id: string; background_job_id: string | null; status: string; mode: WebsiteCaptureTask["mode"] } | undefined = (await claimWebsiteCaptureRetry(options.db, request.params.taskId, viewer.workspace.id, user.id)) ?? undefined;
      if (!taskRow) {
        taskRow = (await options.db.query<{ id: string; background_job_id: string | null; status: string; mode: WebsiteCaptureTask["mode"] }>(
          `select id,background_job_id,status,mode
             from website_capture_tasks where id=$1 and workspace_id=$2 and created_by=$3`,
          [request.params.taskId, viewer.workspace.id, user.id],
        )).rows[0];
        if (taskRow && (taskRow.status === "queued" || taskRow.status === "running")) {
          if (taskRow.status === "queued" && taskRow.mode === "local") {
            await options.assistantHub.startLocalTask(taskRow.id, user.id);
          } else if (taskRow.status === "queued" && taskRow.background_job_id) {
            const job = await options.db.query<{ status: string }>("select status from background_jobs where id=$1 and created_by=$2", [taskRow.background_job_id, user.id]);
            if (job.rows[0] && ["failed", "dead_letter"].includes(job.rows[0].status)) {
              try {
                await options.jobService.retryJob(user, taskRow.background_job_id);
              } catch (retryError) {
                const latestJob = await options.db.query<{ status: string }>("select status from background_jobs where id=$1 and created_by=$2", [taskRow.background_job_id, user.id]);
                if (!latestJob.rows[0] || !["queued", "running", "succeeded"].includes(latestJob.rows[0].status)) throw retryError;
              }
              await options.db.query("insert into website_capture_events(task_id,stage,detail) values($1,'retry_recovered','恢复未完成的后台重试')", [taskRow.id]);
            }
          }
          return reply.send({ ok: true, data: { task: await loadTask(options.db, taskRow.id, viewer.workspace.id), reused: true } });
        }
        return reply.code(409).send({ ok: false, error: { code: "task_not_retryable", message: "任务不存在或当前不可重试。" } });
      }
      if (taskRow.mode !== "local" && !taskRow.background_job_id) {
        await options.db.query("update website_capture_tasks set status='failed',stage='failed',error_message='缺少后台任务记录，无法安全重试',updated_at=now() where id=$1 and status='queued'", [taskRow.id]);
        return reply.code(409).send({ ok: false, error: { code: "task_not_retryable", message: "缺少后台任务记录，无法安全重试。" } });
      }
      try {
        if (taskRow.mode === "local") await options.assistantHub.startLocalTask(taskRow.id, user.id);
        else await options.jobService.retryJob(user, taskRow.background_job_id!);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "网站任务重新排队失败。";
        await options.db.query("update website_capture_tasks set status='failed',stage='failed',error_message=$2,updated_at=now() where id=$1 and status in ('queued','running')", [taskRow.id, message]);
        await options.db.query("insert into website_capture_events(task_id,stage,detail) values($1,'retry_failed',$2)", [taskRow.id, message]);
        throw error;
      }
      await options.db.query("insert into website_capture_events(task_id,stage,detail) values($1,'queued','用户请求重试')", [taskRow.id]);
      return reply.send({ ok: true, data: { task: await loadTask(options.db, taskRow.id, viewer.workspace.id), reused: false } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });

  app.post<{ Params: { taskId: string } }>("/api/website-capture/:taskId/promo/prepare", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    if (!options.generationApprovalService || !options.tierGuard || !options.jobService) {
      return reply.code(503).send({ ok: false, error: { code: "promo_unavailable", message: "宣传成片服务当前不可用。" } });
    }
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const found = await options.db.query<{
        id: string;
        workspace_id: string;
        created_by: string;
        session_id: string | null;
        result: { pages?: Array<{ assetId: string; title: string }> } | null;
        promo: WebsiteCapturePromo | null;
        promo_status: string;
      }>(
        `select id,workspace_id,created_by,session_id,result,promo,promo_status
           from website_capture_tasks where id=$1 and workspace_id=$2 and created_by=$3 and status='succeeded'`,
        [request.params.taskId, viewer.workspace.id, user.id],
      );
      const task = found.rows[0];
      if (!task?.promo?.enabled) return reply.code(409).send({ ok: false, error: { code: "promo_not_requested", message: "此网站任务没有请求宣传成片。" } });
      if (task.promo_status === "awaiting_approval") return reply.send({ ok: true, data: { state: "confirmation_required" } });
      if (task.promo_status === "queued" || task.promo_status === "running") return reply.send({ ok: true, data: { state: task.promo_status } });
      const inputAssetIds = (task.result?.pages ?? []).map((page) => page.assetId).filter(Boolean).slice(0, 14);
      if (!inputAssetIds.length) return reply.code(409).send({ ok: false, error: { code: "promo_missing_sources", message: "没有可用于宣传成片的页面截图。" } });
      const modelRow = task.promo.model
        ? { model_id: task.promo.model }
        : (await options.db.query<{ model_id: string }>(
            `select pm.model_id from provider_models pm join provider_configs pc on pc.id=pm.provider_id
              where pm.media_type='video' and pm.enabled=true and pc.enabled=true
                and pc.health_status='healthy' and pm.health_status <> 'unhealthy'
              order by pm.price_credits asc nulls last limit 1`,
          )).rows[0];
      if (!modelRow?.model_id) return reply.code(409).send({ ok: false, error: { code: "promo_model_unavailable", message: "当前没有可用的视频模型。" } });
      const estimatedCredits = await options.tierGuard.calculateCreditCost(modelRow.model_id, "video_generation", { duration: task.promo.durationSeconds, resolution: "720p" });
      const parameters = {
        prompt: `制作一个中文网站宣传成片：根据提供的网站关键页面截图，清晰展示网站定位、主要页面和用户路径。只使用截图中可验证的信息，不虚构功能，不展示敏感数据。旁白语言：${task.promo.narrationLanguage === "none" ? "无旁白" : "中文"}。`,
        model: modelRow.model_id,
        duration: task.promo.durationSeconds,
        resolution: "720p",
        aspect_ratio: task.promo.aspectRatio,
        enable_audio: task.promo.narrationLanguage !== "none",
        input_asset_ids: inputAssetIds,
        website_capture_task_id: task.id,
      };
      const gate = await options.generationApprovalService.gate({
        workspaceId: viewer.workspace.id,
        userId: user.id,
        jobType: "video_generation",
        model: modelRow.model_id,
        payload: parameters,
        estimatedCredits,
        context: { ...(task.session_id ? { sessionId: task.session_id } : {}), websiteCaptureTaskId: task.id },
      });
      if (gate.state === "confirmation_required") {
        await options.db.query("update website_capture_tasks set promo_status='awaiting_approval', promo_approval_id=$2, promo_error=null, updated_at=now() where id=$1", [task.id, gate.request.approvalId]);
        return reply.send({ ok: true, data: { state: "confirmation_required", request: gate.request } });
      }
      const job = await options.jobService.createJob(user, {
        workspaceId: viewer.workspace.id,
        ...(task.session_id ? { sessionId: task.session_id } : {}),
        idempotencyKey: `website-promo:${task.id}`,
        jobType: "video_generation",
        payload: parameters,
      });
      if (options.creditService && estimatedCredits > 0) {
        const transactionId = await options.creditService.deductCredits(viewer.workspace.id, user.id, estimatedCredits, job.id, "Website promo video");
        await options.jobService.setCreditsInfo(job.id, estimatedCredits, transactionId);
      }
      await options.db.query("update website_capture_tasks set promo_status='queued', promo_job_id=$2, promo_error=null, updated_at=now() where id=$1", [task.id, job.id]);
      return reply.send({ ok: true, data: { state: "queued", jobId: job.id, estimatedCredits, model: modelRow.model_id } });
    } catch (error) {
      return sendWebsiteCaptureError(error, reply);
    }
  });
}

async function loadTask(db: Pool, taskId: string, workspaceId: string): Promise<WebsiteCaptureTask | null> {
  const { rows } = await db.query<TaskRow>(
    `select id, background_job_id, status, mode, start_url, page_limit, record_video, progress, stage, result,
            error_message, created_at, updated_at, follow_external, assistant_connection_id,
            promo, promo_status, promo_approval_id, promo_job_id, promo_video_url, promo_error
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
    ...(row.promo_status ? { promoStatus: row.promo_status } : {}),
    ...(row.promo !== undefined ? { promo: row.promo } : {}),
    ...(row.promo_approval_id !== undefined ? { promoApprovalId: row.promo_approval_id } : {}),
    ...(row.promo_job_id !== undefined ? { promoJobId: row.promo_job_id } : {}),
    ...(row.promo_video_url !== undefined ? { promoVideoUrl: row.promo_video_url } : {}),
    ...(row.promo_error !== undefined ? { promoError: row.promo_error } : {}),
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
