// @credits-system — Worker process: handles job failure refunds (credit refund on generation error)
import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if GLOBAL_AGENT_HTTP_PROXY is set
bootstrap();

// Native fetch() proxy — needed for @google/generative-ai SDK
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { loadServerEnv } from "./config/env.js";
import { createPgmqClient, type PgmqMessage } from "./queue/pgmq-client.js";
import { createJobService } from "./features/jobs/job-service.js";
import {
  createCreditService,
  type CreditService,
} from "./features/credits/credit-service.js";
import {
  getExecutor,
  type ExecutorContext,
} from "./features/jobs/job-executor.js";
import { createLocalJobQueue } from "./queue/local-job-queue.js";
import { createLocalJobService } from "./local-db/job-service.js";
import { createLocalCreditService } from "./local-db/credit-service.js";
import { createLocalDbPool } from "./local-db/client.js";
import { createStorageProvider } from "./storage/index.js";
import { syncDueTrendSources } from "./features/feed/trend-sync.js";
import { processDuePublishingPlans } from "./features/feed/publishing-scheduler.js";
import { processDueSyncJobs } from "./features/jobs/sync-service.js";
import { startOneTakeWorker } from "./features/onetake/worker.js";
import { PeriodicTasks } from "./runtime/periodic-tasks.js";
import { startQueueRunner } from "./runtime/queue-runner.js";
import { createProcessReceipt } from "./runtime/process-receipt.js";
import { assertWorkerDependencies } from "./runtime/worker-readiness.js";
import {
  ActiveJobTracker,
  checkpointActiveJobs,
  JOB_SHUTDOWN_STAGE,
} from "./runtime/job-shutdown-checkpoint.js";
import { recoverInterruptedJobs } from "./runtime/job-recovery.js";
import { recoverCanceledRefunds } from "./runtime/canceled-refund-recovery.js";
import { reconcileGenerationBilling } from "./runtime/billing-reconciliation.js";
import { shouldQuarantineCanceledReplay } from "./runtime/cancellation-recovery.js";

// Import executors to trigger registration via side effects
import "./features/jobs/executors/image-generation.js";
import "./features/jobs/executors/video-generation.js";
import "./features/jobs/executors/feed-structure.js";
import "./features/jobs/executors/website-capture.js";
import { isFeedRenderPayload, markFeedPackageFailed } from "./features/jobs/executors/feed-render.js";

import {
  type AnyBackgroundJobType,
  type BackgroundJobType,
} from "@helstera/shared";

// Register all image/video providers via shared helper (keeps parity with app.ts)
import { registerAllProviders } from "./generation/providers/register-all.js";

// 代码执行由 LocalShellBackend 的内置 execute 工具直接处理，不走 PGMQ。
const QUEUES = [
  "image_generation_jobs",
  "video_generation_jobs",
  "feed_structure_jobs",
  "website_capture_jobs",
] as const;

const JOB_STALE_AFTER_MS = 10 * 60 * 1000;

const QUEUE_TO_TYPE: Record<string, AnyBackgroundJobType> = {
  image_generation_jobs: "image_generation",
  video_generation_jobs: "video_generation",
  feed_structure_jobs: "feed_structure",
  website_capture_jobs: "website_capture",
};

const VT_BY_QUEUE: Record<string, number> = {
  image_generation_jobs: 120,
  // Video providers can take several minutes. Keep the message invisible
  // until the executor finishes so one job cannot run concurrently twice.
  video_generation_jobs: 1200,
  feed_structure_jobs: 300,
  website_capture_jobs: 180,
};



export async function startWorker() {
  const env = loadServerEnv();
  const receipt = createProcessReceipt("worker");

  const databaseUrl = env.databaseUrl;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required for the local worker process.");
    process.exit(1);
  }

  // Register all generation providers (shared with app.ts)
  registerAllProviders(env);

  const localDb = createLocalDbPool(databaseUrl);
  const pgmq = createLocalJobQueue(localDb);
  const jobService = createLocalJobService(localDb, pgmq);
  const creditService = createLocalCreditService(localDb);
  const storageRoot = env.storageRoot ?? "/www/helstera/uploads";
  const storage = createStorageProvider({ provider: "local", root: storageRoot, baseUrl: env.webOrigin });
  await assertWorkerDependencies(localDb, storageRoot, env.capacityPolicy);
  const maintenanceDb = localDb;
  const maintenance = new PeriodicTasks((name, error) => console.error(`[worker:${name}] maintenance failed`, error));
  const stopOneTake = process.env.HELSTERA_ONETAKE_PYTHON ? startOneTakeWorker(localDb, storageRoot, env.capacityPolicy) : async () => {};
  const getAdminClient = () => {
    throw new Error("Supabase runtime support has been removed; use local PostgreSQL services.");
  };

  if (localDb) {
    const recovery = await recoverInterruptedJobs(localDb);
    if (recovery.expired) console.warn(`[worker] Failed ${recovery.expired} stale video job(s) beyond the hard timeout.`);
    if (recovery.recovered) console.warn(`[worker] Requeued ${recovery.recovered} interrupted job(s) after startup.`);
  }

  const reapStaleJobs = async () => {
    if (!localDb) return;
    try {
      const { rowCount } = await localDb.query(
        `update background_jobs
         set status = 'failed',
             error_code = 'stale_job_timeout',
             error_message = 'Job exceeded the 30-minute recovery window.',
             failed_at = now(),
             updated_at = now()
         where status = 'running'
           and job_type = 'video_generation'
           and updated_at < now() - interval '30 minutes'`,
      );
      if (rowCount) {
        console.warn(`[worker] Reaped ${rowCount} stale video job(s).`);
      }
    } catch (error) {
      console.error('[worker] stale-job reaper failed:', error);
    }
  };
  maintenance.every("stale-jobs", 60_000, reapStaleJobs);
  maintenance.every("canceled-refunds", 60_000, async () => {
    const recovery = await recoverCanceledRefunds(localDb);
    if (recovery.refunded.length || recovery.review.length || recovery.failed.length) {
      console.info("[worker] canceled refund recovery", recovery);
    }
  });
  let trendSyncRunning = false;
  let publishingScheduleRunning = false;
  const syncTrends = async () => {
    if (trendSyncRunning) return;
    trendSyncRunning = true;
    try {
      await withAdvisoryLock(maintenanceDb, "loomic:feed-trend-sync", () => syncDueTrendSources(maintenanceDb));
    } catch (error) {
      console.error("[feed-trends] sync cycle failed:", error);
    } finally {
      trendSyncRunning = false;
    }
  };
  maintenance.every("trend-sync", 5 * 60 * 1000, syncTrends);
  const processPublishingSchedule = async () => {
    if (publishingScheduleRunning) return;
    publishingScheduleRunning = true;
    try {
      const count = await processDuePublishingPlans(maintenanceDb);
      if (count > 0) console.log(`[publishing-scheduler] notified ${count} due plan(s)`);
    } catch (error) {
      console.error("[publishing-scheduler] cycle failed:", error);
    } finally {
      publishingScheduleRunning = false;
    }
  };
  maintenance.every("publishing", 30_000, processPublishingSchedule);
  let syncRunning = false;
  const processSync = async () => {
    if (syncRunning) return;
    syncRunning = true;
    try {
      const count = await processDueSyncJobs(localDb, storage);
      if (count > 0) console.log(`[generation-sync] processed ${count} due sync job(s)`);
    } catch (error) {
      console.error("[generation-sync] cycle failed:", error);
    } finally {
      syncRunning = false;
    }
  };
  maintenance.every("generation-sync", 30_000, processSync);

  // Base context — per-message fields (queue, msgId, renewVt) are added in processMessage
  const baseCtx = {
    jobService,
    pgmq,
    getAdminClient,
    env,
    storage,
    ...(localDb ? { localDb } : {}),
  };

  const CONCURRENCY_BY_QUEUE: Record<string, number> = {
    image_generation_jobs: env.workerImageConcurrency ?? 3,
    video_generation_jobs: env.workerVideoConcurrency ?? 2,
    feed_structure_jobs: 2,
    website_capture_jobs: 1,
  };

  const pollTimeoutSeconds = Math.max(1, Math.floor((env.workerPollIntervalMs ?? 5000) / 1000));
  const workerId = env.workerId ?? randomUUID().slice(0, 8);
  const tag = `[worker:${workerId}]`;
  const activeJobIds = new ActiveJobTracker();
  let shutdownRequested = false;
  const runner = startQueueRunner<PgmqMessage>({
    queues: QUEUES.map(name => ({ name, concurrency: CONCURRENCY_BY_QUEUE[name] ?? 1 })),
    poll: (queue, available) => pgmq.readWithPoll(queue, VT_BY_QUEUE[queue] ?? 120, available, pollTimeoutSeconds, 500),
    execute: async (queue, msg) => {
      const jobId = typeof msg.message.job_id === "string" ? msg.message.job_id : "";
      let claimedJobId = "";
      try {
        const ctx: ExecutorContext = {
          ...baseCtx,
          queue,
          msgId: msg.msg_id,
          renewVt: async (vtSeconds: number) => {
            try { await pgmq.setVt(queue, msg.msg_id, vtSeconds); }
            catch (error) { console.warn(`[renewVt] failed for msg ${msg.msg_id}:`, error); }
          },
          heartbeat: (progress, stage) => jobService.updateProgress(String(msg.message.job_id), progress, stage),
        };
        await processMessage(
          queue,
          msg,
          ctx,
          creditService,
          tag,
          () => shutdownRequested,
          (claimedId) => {
            claimedJobId = claimedId;
            activeJobIds.enter(claimedId);
          },
        );
      } finally {
        activeJobIds.leave(claimedJobId);
      }
    },
    release: async (queue, msg) => { await pgmq.setVt(queue, msg.msg_id, 0); },
    onError: (queue, error) => console.error(`${tag} ${queue} failed:`, error),
  });

  let stopping: Promise<void> | undefined;
  const shutdown = () => {
    stopping ??= (async () => {
      console.log(`${tag} Shutting down, waiting for ${runner.activeCount} in-flight jobs...`);
      shutdownRequested = true;
      // Stop intake before waiting: a pending query must never escape the drain.
      const drained = runner.stop();
      const checkpoint = checkpointActiveJobs(jobService, activeJobIds.ids());
      const failures: unknown[] = [];
      const settle = async (label: string, task: Promise<unknown>) => {
        try {
          await task;
        } catch (error) {
          failures.push(new Error(`${label} failed`, { cause: error }));
        }
      };

      await Promise.all([
        settle("queue drain", drained),
        settle("maintenance stop", maintenance.stop()),
        settle("OneTake stop", stopOneTake()),
        settle("job shutdown checkpoint", checkpoint),
      ]);
      await settle("queue shutdown", pgmq.shutdown());
      await settle("database shutdown", localDb.end());
      if (failures.length) throw new AggregateError(failures, "Worker shutdown failed");
      await receipt.drained();
      console.log(`${tag} Shutdown complete.`);
    })().catch(error => { console.error(`${tag} Shutdown failed:`, error); process.exitCode = 1; });
    return stopping;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(`${tag} Started. concurrency=${JSON.stringify(CONCURRENCY_BY_QUEUE)}, longPollTimeout=${pollTimeoutSeconds}s`);
  try {
    await receipt.ready();
    process.send?.("ready");
  } catch (error) {
    await shutdown();
    throw error;
  }

}

async function withAdvisoryLock(
  db: Pool,
  lockKey: string,
  task: () => Promise<void>,
): Promise<boolean> {
  const client = await db.connect();
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      [lockKey],
    );
    if (rows[0]?.acquired !== true) return false;
    try {
      await task();
      return true;
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    client.release();
  }
}

async function claimLocalJob(
  jobId: string,
  ctx: ExecutorContext,
): Promise<JobClaim> {
  const attempt = await ctx.jobService.claimJob(jobId);
  if (attempt) return { state: "claimed", ...attempt };

  const current = await ctx.jobService.getJobAdmin(jobId);
  return current.status === "running" ? { state: "in_progress" } : null;
}

type JobClaim =
  | { state: "claimed"; attempt_count: number; max_attempts: number }
  | { state: "in_progress" }
  | null;

async function processMessage(
  queue: string,
  msg: PgmqMessage,
  ctx: ExecutorContext,
  creditService: CreditService,
  tag: string,
  shutdownRequested: () => boolean = () => false,
  onClaimed: (jobId: string) => void = () => undefined,
) {
  const jobId = msg.message.job_id as string;
  const jobType =
    (msg.message.job_type as AnyBackgroundJobType) ?? QUEUE_TO_TYPE[queue];

  if (!jobId || !jobType) {
    console.error(`${tag} Invalid message in ${queue}:`, msg.message);
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  // Extract traceability context from PGMQ message (if present)
  const sessionShort =
    typeof msg.message.session_id === "string"
      ? msg.message.session_id.slice(0, 8)
      : undefined;
  const startTime = Date.now();
  console.log(
    `${tag} Processing job ${jobId} (${jobType})${sessionShort ? ` session:${sessionShort}` : ""}`,
  );

  const executor = getExecutor(jobType);
  if (!executor) {
    console.error(`${tag} No executor for job type: ${jobType}`);
    await ctx.jobService.markFailed(
      jobId,
      "no_executor",
      `No executor registered for ${jobType}`,
    );
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  const attempt = await claimLocalJob(jobId, ctx);
  if (!attempt) {
    await ctx.pgmq.archive(queue, msg.msg_id);
    console.warn(`${tag} Ignored duplicate or already-finished job ${jobId}.`);
    return;
  }
  if (attempt.state === "in_progress") {
    await ctx.pgmq.setVt(queue, msg.msg_id, VT_BY_QUEUE[queue] ?? 120);
    console.warn(`${tag} Job ${jobId} is still running; retained the redelivered message.`);
    return;
  }
  const { attempt_count, max_attempts } = attempt;
  // Only the worker that won the atomic claim may checkpoint this job.
  onClaimed(jobId);
  await ctx.jobService.updateProgress(jobId, 5, "已领取任务");
  if (attempt_count > 1) {
    const job = await ctx.jobService.getJobAdmin(jobId);
    if (shouldQuarantineCanceledReplay({
      attemptCount: attempt_count,
      cancelRequestedAt: job.cancel_requested_at,
      providerCheckpointExists: await ctx.jobService.hasProviderCheckpoint(jobId),
    })) {
      await ctx.jobService.markCancellationOutcomeUnknown(
        jobId,
        "任务在取消请求后中断，供应商结果回执未保存；预扣积分保留，禁止自动重跑，请核验供应商任务。",
      );
      await ctx.pgmq.archive(queue, msg.msg_id);
      console.error(`${tag} Job ${jobId} replay quarantined after an unresolved cancellation request.`);
      return;
    }
  }
  if (shutdownRequested()) {
    await ctx.jobService.markShutdownRequested(jobId, JOB_SHUTDOWN_STAGE);
  }

  try {
    const result = await executor(
      jobId,
      msg.message as Record<string, unknown>,
      ctx,
    );
    await syncWebsitePromoTask(jobId, result, ctx);
    await reconcileGenerationBilling(jobId, result, ctx, tag);
    if (result.sync_pending === true) {
      await ctx.jobService.markSyncPending(
        jobId,
        result,
        typeof result.sync_error_code === "string" ? result.sync_error_code : "canvas_sync_failed",
        typeof result.sync_error_message === "string" ? result.sync_error_message : "Canvas synchronization is pending.",
      );
      await ctx.pgmq.deleteMsg(queue, msg.msg_id);
      console.warn(`${tag} Job ${jobId} Provider result saved; Canvas sync pending.`);
      return;
    }
    await ctx.jobService.markSucceeded(jobId, result);
    await ctx.pgmq.deleteMsg(queue, msg.msg_id);
    console.log(`${tag} Job ${jobId} succeeded +${Date.now() - startTime}ms`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorCode = (err as { code?: string })?.code ?? "executor_error";
    await failWebsitePromoTask(jobId, errorMessage, ctx);
    let providerCheckpointExists = false;
    try {
      providerCheckpointExists = await ctx.jobService.hasProviderCheckpoint(jobId);
    } catch (checkpointError) {
      providerCheckpointExists = true;
      console.error(`${tag} Could not inspect Provider checkpoint for ${jobId}; preserving charged outcome:`, checkpointError);
    }

    if (providerCheckpointExists && errorCode === "generation_settlement_review_required") {
      await ctx.jobService.markSyncFailed(jobId, errorCode, errorMessage);
      await ctx.pgmq.archive(queue, msg.msg_id);
      console.warn(`${tag} Job ${jobId} is waiting for settlement review; the saved result will not be generated again.`);
      return;
    }

    if (!providerCheckpointExists) {
      const cancellationRetained = await ctx.jobService.markCancellationOutcomeUnknown(
        jobId,
        "取消请求期间任务异常结束；供应商是否已接受或计费未知，预扣积分未退款，请核验供应商任务回执。",
      );
      if (cancellationRetained) {
        await ctx.pgmq.archive(queue, msg.msg_id);
        console.error(`${tag} Job ${jobId} cancellation outcome is unknown; kept the reservation and stopped automatic retry.`);
        return;
      }
    }

    // Non-retryable errors: retrying with the same input will always fail.
    // Dead-letter immediately so the caller (agent polling) gets fast feedback.
    const NON_RETRYABLE_CODES = new Set([
      "invalid_input",
      "model_not_found",
      "provider_not_found",
      "safety_filter",
      "upstream_task_accepted",
      "upstream_submit_timeout",
      "upstream_poll_timeout",
      "upstream_outcome_unknown",
      "upstream_task_failed",
      "upstream_insufficient_balance",
      "invalid_provider_response",
      "provider_auth_failed",
      "provider_request_failed",
      "job_canceled",
      "connector_disabled",
      "invalid_url",
      "blocked_protocol",
      "url_credentials_blocked",
      "private_address_blocked",
      "recording_too_large",
      "missing_token_usage",
      "missing_provider_duration",
      "generation_settlement_review_required",
    ]);
    const shouldDeadLetter = attempt_count >= max_attempts || (!providerCheckpointExists && NON_RETRYABLE_CODES.has(errorCode));

    if (shouldDeadLetter) {
      if (providerCheckpointExists) {
        await ctx.jobService.markSyncFailed(jobId, errorCode, errorMessage);
        await ctx.pgmq.archive(queue, msg.msg_id);
        console.error(`${tag} Job ${jobId} retains its successful Provider result; synchronization requires recovery: ${errorMessage}`);
        return;
      }
      const jobPayload = await loadJobPayload(jobId, ctx);
      if (jobPayload && isFeedRenderPayload(jobPayload)) {
        try {
          await markFeedPackageFailed(ctx, jobPayload, errorMessage);
        } catch (packageError) {
          console.error(`${tag} Failed to mark feed package ${jobPayload.feed_package_id}:`, packageError);
        }
      }
      await ctx.jobService.markDeadLetter(jobId, errorCode, errorMessage);
      await ctx.pgmq.archive(queue, msg.msg_id);

      // Do not refund when the provider accepted work but the final outcome is unknown.
      // A late upstream success must not become a free generation.
      if (!isProviderOutcomeUnknown(errorCode)) {
        await refundDeadLetteredJob(jobId, ctx, creditService, tag);
      }

      console.error(
        `${tag} Job ${jobId} dead-lettered after ${attempt_count} attempts +${Date.now() - startTime}ms: ${errorMessage}`,
      );
    } else {
      await ctx.jobService.markFailed(jobId, errorCode, errorMessage);
      // PGMQ re-delivers after VT. The local queue is status-backed, so it
      // must explicitly return retryable jobs to queued state.
      if (ctx.localDb) {
        await ctx.localDb.query(
          "update background_jobs set status = 'queued', updated_at = now() where id = $1 and status = 'failed'",
          [jobId],
        );
      }
      console.warn(
        `${tag} Job ${jobId} failed (attempt ${attempt_count}/${max_attempts}) +${Date.now() - startTime}ms: ${errorMessage}`,
      );
    }
  }
}

async function syncWebsitePromoTask(jobId: string, result: Record<string, unknown>, ctx: ExecutorContext) {
  if (!ctx.localDb) return;
  const { rows } = await ctx.localDb.query<{ payload: Record<string, unknown> }>("select payload from background_jobs where id=$1 and job_type='video_generation'", [jobId]);
  const taskId = typeof rows[0]?.payload?.website_capture_task_id === "string" ? rows[0].payload.website_capture_task_id : null;
  if (!taskId) return;
  await ctx.localDb.query(
    "update website_capture_tasks set promo_status='succeeded', promo_asset_id=$2, promo_video_url=$3, promo_error=null, updated_at=now() where id=$1",
    [taskId, typeof result.asset_id === "string" ? result.asset_id : null, typeof result.signed_url === "string" ? result.signed_url : null],
  );
}

async function failWebsitePromoTask(jobId: string, message: string, ctx: ExecutorContext) {
  if (!ctx.localDb) return;
  const { rows } = await ctx.localDb.query<{ payload: Record<string, unknown> }>("select payload from background_jobs where id=$1 and job_type='video_generation'", [jobId]);
  const taskId = typeof rows[0]?.payload?.website_capture_task_id === "string" ? rows[0].payload.website_capture_task_id : null;
  if (!taskId) return;
  await ctx.localDb.query("update website_capture_tasks set promo_status='failed', promo_error=$2, updated_at=now() where id=$1 and promo_status in ('queued','running','awaiting_approval')", [taskId, message.slice(0, 1000)]);
}

async function loadJobPayload(
  jobId: string,
  ctx: ExecutorContext,
): Promise<Record<string, unknown> | null> {
  if (ctx.localDb) {
    const { rows } = await ctx.localDb.query<{ payload: Record<string, unknown> }>(
      "select payload from background_jobs where id=$1",
      [jobId],
    );
    return rows[0]?.payload ?? null;
  }
  const { data } = await ctx.getAdminClient().from("background_jobs").select("payload").eq("id", jobId).maybeSingle();
  return (data?.payload as Record<string, unknown> | undefined) ?? null;
}

/**
 * Refund credits for a dead-lettered job if credits were deducted.
 * Only dead-lettered (permanently failed) jobs get refunds — not cancelled jobs.
 */
function isProviderOutcomeUnknown(errorCode: string) {
  return errorCode === "upstream_task_accepted"
    || errorCode === "upstream_submit_timeout"
    || errorCode === "upstream_poll_timeout"
    || errorCode === "upstream_outcome_unknown";
}

async function refundDeadLetteredJob(
  jobId: string,
  ctx: ExecutorContext,
  creditService: CreditService,
  tag: string,
) {
  try {
    const jobRow = ctx.localDb
      ? (
          await ctx.localDb.query(
            "select credits_cost, workspace_id, created_by from background_jobs where id=$1",
            [jobId],
          )
        ).rows[0]
      : (
          await ctx
            .getAdminClient()
            .from("background_jobs")
            .select("credits_cost, workspace_id, created_by")
            .eq("id", jobId)
            .single()
        ).data;

    if (!jobRow) return;

    const creditsCost = Number(jobRow.credits_cost ?? 0);
    const workspaceId = jobRow.workspace_id;
    const createdBy = jobRow.created_by;

    if (creditsCost <= 0 || !workspaceId || !createdBy) return;

    const txId = await creditService.refundCredits(
      workspaceId,
      createdBy,
      creditsCost,
      jobId,
      "Auto-refund: job failed",
    );
    console.log(
      `${tag} Refunded ${creditsCost} credits for job ${jobId} (tx: ${txId})`,
    );
  } catch (refundErr) {
    // Log but don't crash the worker — the job is already dead-lettered
    console.error(
      `${tag} Failed to refund credits for job ${jobId}:`,
      refundErr,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// PM2 executes a container script, so process.argv[1] is not the configured
// Worker path. Prefer PM2's explicit entry path while retaining direct Node
// execution for local development and recovery tools.
const entryPath = process.env.pm_exec_path ?? process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  startWorker().catch((err) => {
    console.error("[worker] Fatal error:", err);
    process.exit(1);
  });
}
