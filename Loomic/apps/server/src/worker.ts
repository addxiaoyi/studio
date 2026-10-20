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

// Import executors to trigger registration via side effects
import "./features/jobs/executors/image-generation.js";
import "./features/jobs/executors/video-generation.js";
import "./features/jobs/executors/feed-structure.js";
import "./features/jobs/executors/website-capture.js";
import { isFeedRenderPayload, markFeedPackageFailed } from "./features/jobs/executors/feed-render.js";

import {
  calculateTokenCredits,
  getConfiguredBilling,
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



async function main() {
  const env = loadServerEnv();

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
  const storage = createStorageProvider({ provider: "local", root: env.storageRoot ?? "/www/helstera/uploads", baseUrl: env.webOrigin });
  const maintenanceDb = localDb;
  const getAdminClient = () => {
    throw new Error("Supabase runtime support has been removed; use local PostgreSQL services.");
  };

  // A local worker can be restarted while a job is in flight. Requeue only
  // jobs that have not updated for a full lease window; active jobs keep
  // renewing updated_at from their executor heartbeat.
  if (localDb) {
    const expired = await localDb.query(
      `update background_jobs
       set status = 'failed',
           error_code = 'stale_job_timeout',
           error_message = 'Job exceeded the 30-minute recovery window.',
           failed_at = now(),
           updated_at = now()
       where status = 'running'
         and job_type = 'video_generation'
         and updated_at < now() - interval '30 minutes'
       returning id`,
    );
    if (expired.rowCount) {
      console.warn(`[worker] Failed ${expired.rowCount} stale video job(s) beyond the hard timeout.`);
    }
    const recovered = await localDb.query(
      `update background_jobs
       set status = 'queued', stage = '�����߳��ѻָ��������Ŷ�', updated_at = now()
       where status = 'running'
         and updated_at < now() - interval '10 minutes'
         and updated_at >= now() - interval '30 minutes'
         and attempt_count < max_attempts
       returning id`,
    );
    if (recovered.rowCount) {
      console.warn(`[worker] Requeued ${recovered.rowCount} stale job(s) after startup.`);
    }
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
  void reapStaleJobs();
  setInterval(() => void reapStaleJobs(), 60_000).unref();
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
  void syncTrends();
  setInterval(() => void syncTrends(), 5 * 60 * 1000).unref();
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
  void processPublishingSchedule();
  setInterval(() => void processPublishingSchedule(), 30 * 1000).unref();
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
  void processSync();
  setInterval(() => void processSync(), 30 * 1000).unref();

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

  const inFlightByQueue = new Map<string, Set<Promise<void>>>(
    QUEUES.map((q) => [q, new Set()]),
  );

  // Server-side long poll: wait up to N seconds inside Postgres for messages,
  // checking every 500ms. This replaces the old client-side sleep(2000) + read()
  // pattern that generated ~340K idle queries per monitoring period.
  const pollTimeoutSeconds = Math.max(
    1,
    Math.floor((env.workerPollIntervalMs ?? 5000) / 1000),
  );
  const workerId = env.workerId ?? randomUUID().slice(0, 8);
  const tag = `[worker:${workerId}]`;

  let running = true;

  // Graceful shutdown — wait for in-flight jobs then exit
  const shutdown = async () => {
    const totalInFlight = [...inFlightByQueue.values()].reduce(
      (n, s) => n + s.size,
      0,
    );
    console.log(
      `${tag} Shutting down, waiting for ${totalInFlight} in-flight jobs...`,
    );
    running = false;
    const allTasks = [...inFlightByQueue.values()].flatMap((s) => [...s]);
    if (allTasks.length > 0) {
      await Promise.allSettled(allTasks);
    }
    await maintenanceDb.end();
    await pgmq.shutdown();
    console.log(`${tag} Shutdown complete.`);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const concurrencyDesc = QUEUES.map(
    (q) => `${q}=${CONCURRENCY_BY_QUEUE[q] ?? 1}`,
  ).join(", ");
  console.log(
    `${tag} Started. concurrency={${concurrencyDesc}}, longPollTimeout=${pollTimeoutSeconds}s`,
  );

  while (running) {
    for (const queue of QUEUES) {
      try {
        const inFlight = inFlightByQueue.get(queue)!;
        const cap = CONCURRENCY_BY_QUEUE[queue] ?? 1;
        const available = cap - inFlight.size;
        if (available <= 0) continue;

        const vt = VT_BY_QUEUE[queue] ?? 120;
        const messages = await pgmq.readWithPoll(
          queue,
          vt,
          available,
          pollTimeoutSeconds,
          500,
        );

        for (const msg of messages) {
          const ctx: ExecutorContext = {
            ...baseCtx,
            queue,
            msgId: msg.msg_id,
            renewVt: async (vtSeconds: number) => {
              try {
                await pgmq.setVt(queue, msg.msg_id, vtSeconds);
              } catch (e) {
                console.warn(`[renewVt] failed for msg ${msg.msg_id}:`, e);
              }
            },
            heartbeat: async (progress: number, stage: string) => {
              await jobService.updateProgress(String(msg.message.job_id), progress, stage);
            },
          };
          const task = processMessage(
            queue,
            msg,
            ctx,
            creditService,
            tag,
          ).finally(() => inFlight.delete(task));
          inFlight.add(task);
        }
      } catch (err) {
        if (!running) break;
        console.error(`${tag} Error polling ${queue}:`, err);
      }
    }
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
  await ctx.jobService.updateProgress(jobId, 5, "已领取任务");

  try {
    const result = await executor(
      jobId,
      msg.message as Record<string, unknown>,
      ctx,
    );
    await reconcileTokenBilling(jobId, result, ctx, creditService, tag);
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
    let providerCheckpointExists = false;
    try {
      providerCheckpointExists = await ctx.jobService.hasProviderCheckpoint(jobId);
    } catch (checkpointError) {
      providerCheckpointExists = true;
      console.error(`${tag} Could not inspect Provider checkpoint for ${jobId}; preserving charged outcome:`, checkpointError);
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
      "invalid_url",
      "blocked_protocol",
      "url_credentials_blocked",
      "private_address_blocked",
      "recording_too_large",
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

async function reconcileTokenBilling(
  jobId: string,
  result: Record<string, unknown>,
  ctx: ExecutorContext,
  creditService: CreditService,
  tag: string,
) {
  const usage = result.usage as
    | { inputTokens?: number; outputTokens?: number }
    | undefined;
  const job = await ctx.jobService.getJobAdmin(jobId);
  const model = typeof job.payload.model === "string" ? job.payload.model : "";
  const billing = getConfiguredBilling(model);
  if (!billing || billing.billingUnit !== "per_million_tokens") return;
  if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) {
    const error = new Error(`Token-billed model ${model} did not return token usage`);
    (error as Error & { code?: string }).code = "missing_token_usage";
    throw error;
  }
  const actualCost = calculateTokenCredits(
    usage.inputTokens,
    usage.outputTokens,
    billing.inputTokenPriceCny,
    billing.outputTokenPriceCny,
  );
  const current = await loadReservedCredits(jobId, ctx);
  const delta = actualCost - current;
  if (delta === 0) return;
  const description = `Token usage: ${model}, input=${usage.inputTokens}@¥${billing.inputTokenPriceCny}/1M, output=${usage.outputTokens}@¥${billing.outputTokenPriceCny}/1M`;
  const txId =
    delta > 0
      ? await creditService.deductCredits(
          job.workspace_id,
          job.created_by,
          delta,
          jobId,
          description,
        )
      : await creditService.refundCredits(
          job.workspace_id,
          job.created_by,
          Math.abs(delta),
          jobId,
          description,
        );
  await ctx.jobService.setCreditsInfo(jobId, actualCost, txId);
  console.log(
    `${tag} Token billing reconciled for ${jobId}: reserved=${current}, actual=${actualCost}`,
  );
}

async function loadReservedCredits(
  jobId: string,
  ctx: ExecutorContext,
): Promise<number> {
  if (ctx.localDb) {
    const { rows } = await ctx.localDb.query<{ credits_cost: number | null }>(
      "select credits_cost from background_jobs where id=$1",
      [jobId],
    );
    return Number(rows[0]?.credits_cost ?? 0);
  }
  const { data } = await ctx
    .getAdminClient()
    .from("background_jobs")
    .select("credits_cost")
    .eq("id", jobId)
    .single();
  return Number(data?.credits_cost ?? 0);
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

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
