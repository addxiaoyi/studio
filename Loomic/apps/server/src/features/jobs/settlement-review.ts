import { settlementReviewSchema } from "@helstera/shared";
import type { Pool } from "pg";
import { settleGenerationCredits } from "../../local-db/generation-settlement.js";
import { JobServiceError } from "./job-service.js";

export async function decideSettlementReview(
  db: Pool,
  jobId: string,
  userId: string,
  reviewId: string,
  decision: "approve" | "reject",
) {
  const client = await db.connect();
  let review;
  try {
    await client.query("begin");
    const job = (await client.query<{ status: string; settlement_review: unknown; result: unknown; billing_approval_id: string | null }>(
      "select status,settlement_review,result,billing_approval_id from background_jobs where id=$1 and created_by=$2 for update", [jobId, userId],
    )).rows[0];
    if (!job) throw new JobServiceError("job_not_found", "任务不存在或无权访问。", 404);
    const parsed = settlementReviewSchema.safeParse(job.settlement_review);
    if (!parsed.success || parsed.data.id !== reviewId) {
      throw new JobServiceError("job_query_failed", "费用确认已更新，请重新读取任务。", 409);
    }
    review = parsed.data;
    if (review.status === "consumed") {
      if (decision === "reject") throw new JobServiceError("job_query_failed", "费用已经结算，不能撤回已执行的确认。", 409);
      await client.query(`update background_jobs set status='sync_pending',next_sync_at=now(),sync_claimed_at=null,updated_at=now()
        where id=$1 and created_by=$2 and status='sync_failed' and billing_receipt is not null`, [jobId, userId]);
      await client.query("commit");
      return;
    }
    if (!["sync_failed", "sync_pending"].includes(job.status)) {
      throw new JobServiceError("job_query_failed", "任务结果尚未准备好，请稍后刷新。", 409);
    }
    if (decision === "reject" && review.status === "approved") {
      throw new JobServiceError("job_query_failed", "费用确认已交付结算，请先核对结果。", 409);
    }
    const status = decision === "approve" ? "approved" : "rejected";
    if (status === "approved" && review.status !== "approved") {
      const approval = (await client.query<{ id: string; workflow_goal: string | null }>(
        `select approval.id,approval.context->>'workflowGoalId' as workflow_goal from generation_approvals approval
         join background_jobs job on job.id=approval.job_id
         where approval.job_id=$1 and approval.user_id=$2 and approval.workspace_id=job.workspace_id
           and approval.status='approved' and approval.consumed_at is not null
           and (job.billing_approval_id is null or approval.id=job.billing_approval_id)
         order by approval.approved_at desc nulls last,approval.created_at desc,approval.id limit 1`, [jobId, userId],
      )).rows[0];
      if (job.billing_approval_id && !approval) {
        throw new JobServiceError("job_query_failed", "原费用确认不可用，请先核对原任务报价。", 409);
      }
      if (approval?.workflow_goal) {
        const run = (await client.query<{ id: string; budget_credits: string }>(
          "select id,budget_credits from canvas_workflow_runs where goal_id=$1 for update", [approval.workflow_goal],
        )).rows[0];
        if (!run) throw new JobServiceError("job_query_failed", "找不到原工作流预算，请核对工作流。", 409);
        const reserved = (await client.query<{ total: string; current: string }>(
          `select coalesce(sum(credits),0) as total,
            coalesce(sum(credits) filter(where approval_id=$2),0) as current
           from canvas_workflow_budget_reservations where run_id=$1`, [run.id, approval.id],
        )).rows[0]!;
        if (Number(reserved.total) - Number(reserved.current) + review.actualCost > Number(run.budget_credits)) {
          throw new JobServiceError("job_query_failed", "补扣会超过工作流预算，请先调整预算后再确认。", 409);
        }
        const changed = await client.query("update canvas_workflow_budget_reservations set credits=$2 where approval_id=$1 and run_id=$3",
          [approval.id, review.actualCost, run.id]);
        if (!changed.rowCount) throw new JobServiceError("job_query_failed", "原预算预留记录缺失，请核对工作流。", 409);
      }
    }
    await client.query("update background_jobs set settlement_review=jsonb_set(settlement_review,'{status}',to_jsonb($3::text)),updated_at=now() where id=$1 and created_by=$2",
      [jobId, userId, status]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
  if (decision === "reject") return;
  await settleGenerationCredits(db, jobId, review);
  // Only resume delivery of the already-created artifact. Never enqueue another model call.
  await db.query(`update background_jobs set status='sync_pending',stage='canvas_sync_pending',
    next_sync_at=now(),sync_claimed_at=null,error_code=null,error_message=null,updated_at=now()
    where id=$1 and created_by=$2 and status='sync_failed' and billing_receipt is not null`, [jobId, userId]);
}
