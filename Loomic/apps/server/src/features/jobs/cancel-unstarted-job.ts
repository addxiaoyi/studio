import type { Pool, PoolClient } from "pg";
import { JobServiceError } from "./job-service.js";

type Reservation = {
  workspace_id: string;
  credits_cost: number | null;
  credits_transaction_id: string | null;
};

async function refundReservation(client: PoolClient, jobId: string, userId: string, job: Reservation): Promise<number> {
  // Use the same job -> balance lock order as initial debit and final settlement.
  const balance = await client.query("select balance from credit_balances where workspace_id=$1 for update", [job.workspace_id]);
  const ledger = (await client.query<{
    id: string; workspace_id: string; user_id: string; transaction_type: string; amount: string;
  }>(`select id,workspace_id,user_id,transaction_type,amount from credit_transactions where job_id=$1
    and transaction_type in ('generation_deduct','generation_refund','generation_adjustment')`, [jobId])).rows;
  const debit = ledger.filter(entry => entry.transaction_type === "generation_deduct");
  const refunds = ledger.filter(entry => entry.transaction_type === "generation_refund");
  const reservation = debit[0];
  const refund = refunds[0];
  const cost = Number(job.credits_cost ?? 0);
  const free = !ledger.length && cost === 0 && !job.credits_transaction_id;
  if (free) return 0;
  const amount = -Number(reservation?.amount);
  const mismatched = ledger.some(entry => entry.workspace_id !== job.workspace_id || entry.user_id !== userId)
    || ledger.some(entry => entry.transaction_type === "generation_adjustment")
    || debit.length !== 1 || refunds.length > 1 || !Number.isFinite(amount) || amount <= 0
    || !Number.isFinite(cost) || cost < 0
    || (cost > 0 && cost !== amount)
    || (job.credits_transaction_id != null && job.credits_transaction_id !== reservation?.id)
    || (refund != null && Number(refund.amount) !== amount);
  if (mismatched || !balance.rows[0] || !reservation) {
    throw new JobServiceError("job_cancel_failed", "任务预扣与账本不一致，需核验后退款。", 409);
  }
  if (refund) return amount;
  const updated = await client.query<{ balance: string }>(
    "update credit_balances set balance=balance-$2::numeric,updated_at=now() where workspace_id=$1 returning balance",
    [job.workspace_id, reservation.amount],
  );
  const credited = updated.rows[0];
  if (!credited) throw new JobServiceError("job_cancel_failed", "退款余额写入失败，请重试取消。", 409);
  await client.query(`insert into credit_transactions(workspace_id,user_id,transaction_type,amount,balance_after,job_id,description)
    values($1,$2,'generation_refund',-$3::numeric,$4,$5,'任务开始前取消，释放预占积分')`,
    [job.workspace_id, userId, reservation.amount, credited.balance, jobId]);
  return amount;
}

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
        credits_transaction_id: string | null;
        started_at: Date | null;
        provider_result: unknown;
        billing_receipt: unknown;
        cancel_requested_at: Date | null;
      }>(
        "select status,attempt_count,workspace_id,credits_cost,credits_transaction_id,started_at,provider_result,billing_receipt,cancel_requested_at from background_jobs where id=$1 and created_by=$2 for update",
        [jobId, userId],
      )
    ).rows[0];
    if (!row)
      throw new JobServiceError("job_not_found", "任务不存在或无权访问。", 404);
    if (row.status === "running") {
      await client.query(
        `update background_jobs
         set cancel_requested_at=coalesce(cancel_requested_at,now()),stage='cancel_requested',
             error_code='cancel_requested',error_message='取消请求已提交，正在等待任务结果。',updated_at=now()
         where id=$1 and status='running'`,
        [jobId],
      );
      await client.query("commit");
      return { workspaceId: row.workspace_id, amount: 0, cancelRequested: true };
    }
    if (!["queued", "canceled"].includes(row.status) || Number(row.attempt_count) > 0 || row.started_at != null || row.provider_result != null || row.billing_receipt != null) {
      throw new JobServiceError(
        "job_cancel_failed",
        "任务已开始或结果尚未确定，不能将其当作取消成功并退款。请等待原任务结果或在任务记录中核验。",
        409,
      );
    }
    const refunded = await refundReservation(client, jobId, userId, row);
    await client.query(
      "update background_jobs set status='canceled',canceled_at=coalesce(canceled_at,now()),updated_at=now() where id=$1",
      [jobId],
    );
    await client.query("commit");
    return {
      workspaceId: row.workspace_id,
      amount: refunded,
      cancelRequested: false,
    };
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}
