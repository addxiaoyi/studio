import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { ExecutorContext } from "../../apps/server/src/features/jobs/job-executor.js";

// The production bootstrap owns createProcessReceipt, claims, recovery and shutdown.
const { startWorker } = await import(pathToFileURL(process.env.RELEASE_TEST_WORKER_MODULE!));
const { registerExecutor } = await import(pathToFileURL(process.env.RELEASE_TEST_EXECUTOR_MODULE!));

registerExecutor("website_capture", async (jobId: string, _message: unknown, context: ExecutorContext) => {
  const db = context.localDb;
  if (!db) throw new Error("The release fixture requires its isolated PostgreSQL schema.");
  const work = (await db.query<{ id: string; duration_ms: number }>(
    "select id,duration_ms from release_work where job_id=$1", [jobId],
  )).rows[0];
  if (!work) throw new Error(`Release work for ${jobId} is missing.`);
  await db.query("insert into release_events(task_id,phase,pid) values($1,'started',$2)", [work.id, process.pid]);
  await db.query("update release_work set state='running',owner_pid=$2 where job_id=$1", [jobId, process.pid]);
  await context.jobService.saveProviderResult(jobId, { fixture: true });
  for (let progress = 10; progress <= 100; progress += 10) {
    await delay(work.duration_ms / 10);
    await context.heartbeat(progress, "release_fixture_processing");
    await db.query("update release_work set progress=$2 where job_id=$1", [jobId, progress]);
  }
  const output = join(process.env.STORAGE_ROOT!, `${jobId}.txt`);
  await writeFile(output, `completed:${work.id}`, { flag: "wx" });
  await db.query("update release_work set state='completed' where job_id=$1", [jobId]);
  await db.query("insert into release_events(task_id,phase,pid) values($1,'completed',$2)", [work.id, process.pid]);
  return { output };
});

await startWorker();
