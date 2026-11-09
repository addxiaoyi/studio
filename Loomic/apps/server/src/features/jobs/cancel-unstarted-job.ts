import type { Pool } from "pg";
import { JobServiceError } from "./job-service.js";

export async function cancelUnstartedJob(
  db: Pool,
  jobId: string,
  userId: string,
) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const row = (
      await client.query<{
        status: string;
        attempt_count: number;
        workspace_id: string;
        credits_cost: number | null;
      }>(
        "select status,attempt_count,workspace_id,credits_cost from background_jobs where id=$1 and created_by=$2 for update",
        [jobId, userId],
      )
    ).rows[0];
    if (!row)
      throw new JobServiceError("job_not_found", "任务不存在或无权访问。", 404);
    if (
      !["queued", "canceled"].includes(row.status) ||
      Number(row.attempt_count) > 0
    )
      throw new JobServiceError(
        "job_cancel_failed",
        "任务已开始或结果尚未确定，不能将其当作取消成功并退款。请等待原任务结果或在任务记录中核验。",
        409,
      );
    await client.query(
      "update background_jobs set status='canceled',canceled_at=coalesce(canceled_at,now()),updated_at=now() where id=$1",
      [jobId],
    );
    await client.query("commit");
    return {
      workspaceId: row.workspace_id,
      amount: Number(row.credits_cost ?? 0),
    };
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}
