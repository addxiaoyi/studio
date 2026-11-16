import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registerExecutor, type JobExecutor } from "../../features/jobs/job-executor.js";
import { startWorker } from "../../worker.js";

// Substitute only the external operation; bootstrap, queue, claims and shutdown are production code.
const executeFixture: JobExecutor = async (jobId, _message, context) => {
  const database = context.localDb;
  if (!database) throw new Error("The Worker fixture requires its isolated database.");
  await database.query("update worker_test_controls set starts=starts+1,owner_pid=$2 where job_id=$1", [jobId, process.pid]);
  const saved = await database.query("select provider_result,payload from background_jobs where id=$1", [jobId]);
  if (!saved.rows[0]?.provider_result) {
    await database.query("update worker_test_controls set submissions=submissions+1 where job_id=$1", [jobId]);
    await context.jobService.saveProviderResult(jobId, { accepted: true });
  }

  for (;;) {
    const control = await database.query("select released from worker_test_controls where job_id=$1", [jobId]);
    if (control.rows[0]?.released) break;
    await context.heartbeat(48, "fixture_heartbeat");
    await database.query("update worker_test_controls set heartbeats=heartbeats+1 where job_id=$1", [jobId]);
    await delay(50);
  }

  const output = join(process.env.STORAGE_ROOT!, `${jobId}.txt`);
  await writeFile(output, `completed:${jobId}`, { flag: "wx" });
  await database.query("update worker_test_controls set completions=completions+1 where job_id=$1", [jobId]);
  return { output, ...(saved.rows[0]?.payload?.settlement_test === true ? { duration_seconds: 12, duration_source: "provider" } : {}) };
};
registerExecutor("website_capture", executeFixture);
registerExecutor("image_generation", executeFixture);

// Windows cannot deliver POSIX signals; exercise the same registered handler over test-only IPC.
process.on("message", (message) => {
  if (process.platform === "win32" && message === "SIGTERM") process.emit("SIGTERM");
});
process.on("disconnect", () => {
  if (process.platform === "win32") process.emit("SIGTERM");
});
process.channel?.unref();

await startWorker();
