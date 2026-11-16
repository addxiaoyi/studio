import type { JobService } from "../features/jobs/job-service.js";

export const JOB_SHUTDOWN_STAGE = "worker_shutdown_waiting";

export class ActiveJobTracker {
  private readonly counts = new Map<string, number>();

  enter(jobId: string) {
    if (!jobId) return;
    this.counts.set(jobId, (this.counts.get(jobId) ?? 0) + 1);
  }

  leave(jobId: string) {
    const count = this.counts.get(jobId);
    if (count === undefined) return;
    if (count <= 1) this.counts.delete(jobId);
    else this.counts.set(jobId, count - 1);
  }

  ids(): string[] {
    return [...this.counts.keys()];
  }
}

export async function checkpointActiveJobs(
  jobService: Pick<JobService, "markShutdownRequested">,
  jobIds: Iterable<string>,
): Promise<number> {
  const uniqueIds = [...new Set(jobIds)].filter(Boolean);
  await Promise.all(
    uniqueIds.map((jobId) =>
      jobService.markShutdownRequested(jobId, JOB_SHUTDOWN_STAGE),
    ),
  );
  return uniqueIds.length;
}
