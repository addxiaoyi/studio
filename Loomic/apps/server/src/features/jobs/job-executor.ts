import type { AnyBackgroundJobType } from "@helstera/shared";
import type { Pool } from "pg";

import type { JobService } from "./job-service.js";
import type { PgmqClient } from "../../queue/pgmq-client.js";
import type { DataAdminClient } from "../../auth/types.js";
import type { ServerEnv } from "../../config/env.js";
import type { StorageProvider } from "../../storage/index.js";

export type ExecutorContext = {
  jobService: JobService;
  pgmq: PgmqClient;
  getAdminClient: () => DataAdminClient;
  env: ServerEnv;
  /** PGMQ queue name for the current job (set per-message by the worker). */
  queue: string;
  /** PGMQ message id for the current job (set per-message by the worker). */
  msgId: number;
  /**
   * Best-effort VT renewal — extends visibility timeout so the message
   * stays invisible while the executor is still working.
   * Never throws; logs on failure.
   */
  renewVt: (vtSeconds: number) => Promise<void>;
  /** Persist a stage heartbeat while a provider call is still running. */
  heartbeat: (progress: number, stage: string) => Promise<void>;
  localDb?: Pool;
  storage: StorageProvider;
};

export type JobExecutor = (
  jobId: string,
  payload: Record<string, unknown>,
  ctx: ExecutorContext,
) => Promise<Record<string, unknown>>;

const executors = new Map<AnyBackgroundJobType, JobExecutor>();

export function registerExecutor(jobType: AnyBackgroundJobType, executor: JobExecutor): void {
  executors.set(jobType, executor);
}

export function getExecutor(jobType: AnyBackgroundJobType): JobExecutor | undefined {
  return executors.get(jobType);
}
