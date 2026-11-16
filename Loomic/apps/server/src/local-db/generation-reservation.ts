import { generationPricingSchema, type GenerationPricing } from "@helstera/shared";
import type { Pool, PoolClient } from "pg";
import { snapshotCatalogPricing } from "../features/generation/pricing-snapshot.js";
import { GenerationSettlementError } from "./generation-settlement.js";

export async function recordGenerationReservation(db: Pool, jobId: string, credits: number, transactionId: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await linkGenerationReservation(client, jobId, credits, transactionId);
    await client.query("commit");
  } catch (cause) { await client.query("rollback"); throw cause; }
  finally { client.release(); }
}

export async function linkGenerationReservation(client: PoolClient, jobId: string, credits: number, transactionId: string) {
    const job = (await client.query<{
      payload: Record<string, unknown>; billing_pricing: unknown; billing_receipt: unknown;
      workspace_id: string; created_by: string; idempotency_key: string | null;
      credits_cost: string | null; credits_transaction_id: string | null;
      billing_approval_id: string | null;
    }>("select payload,billing_pricing,billing_receipt,workspace_id,created_by,idempotency_key,credits_cost,credits_transaction_id,billing_approval_id from background_jobs where id=$1 for update", [jobId])).rows[0];
    if (!job) throw new GenerationSettlementError("找不到需要关联预扣凭证的任务。");
    if (job.billing_receipt) return;
    if (job.credits_transaction_id && (job.credits_transaction_id !== transactionId || Number(job.credits_cost) !== credits)) {
      throw new GenerationSettlementError("任务已关联另一份预扣凭证，不能覆盖原金额。");
    }
    let pricing: GenerationPricing | null = job.billing_pricing ? generationPricingSchema.parse(job.billing_pricing) : null;
    if (!pricing || job.billing_approval_id) {
      const approval = (await client.query<{ billing_pricing: unknown }>(
        `select billing_pricing from generation_approvals where workspace_id=$2 and user_id=$3 and status='approved'
         and (($5::uuid is not null and id=$5) or ($5::uuid is null and (job_id=$1 or ('approval:'||id::text)=$4)))
         and estimated_credits=$6 order by approved_at desc nulls last,created_at desc,id limit 1`,
        [jobId, job.workspace_id, job.created_by, job.idempotency_key, job.billing_approval_id, credits],
      )).rows[0];
      if (job.billing_approval_id && !approval) {
        throw new GenerationSettlementError("预扣金额与绑定的费用确认不一致，请重新核对原任务报价。");
      }
      if (job.billing_approval_id && !approval?.billing_pricing) {
        throw new GenerationSettlementError("原费用确认缺少价格快照，请重新查询并确认费用。");
      }
      if (!pricing && approval?.billing_pricing) pricing = generationPricingSchema.parse(approval.billing_pricing);
    }
    const model = typeof job.payload.model === "string" ? job.payload.model : "";
    if (!pricing) {
      const provider = (await client.query<{
        billing_unit: string; input_token_price_cny: string | null; output_token_price_cny: string | null;
      }>(`select pm.billing_unit,pm.input_token_price_cny,pm.output_token_price_cny
        from provider_models pm join provider_configs pc on pc.id=pm.provider_id
        where pm.model_id=$1 and pm.enabled=true and pc.enabled=true and pc.health_status='healthy'
        order by pm.priority,pc.latency_ms nulls last limit 1`, [model])).rows[0];
      if (provider?.billing_unit === "per_second" && typeof job.payload.duration === "number" && job.payload.duration > 0) {
        pricing = generationPricingSchema.parse({ billingUnit: "per_second", creditCost: credits / job.payload.duration });
      } else if (provider?.billing_unit === "per_million_tokens") {
        pricing = generationPricingSchema.parse({ billingUnit: "per_million_tokens",
          inputTokenPriceCny: provider.input_token_price_cny === null ? null : Number(provider.input_token_price_cny),
          outputTokenPriceCny: provider.output_token_price_cny === null ? null : Number(provider.output_token_price_cny) });
      } else if (provider) {
        pricing = generationPricingSchema.parse({ billingUnit: "per_generation", creditCost: credits });
      }
    }
    if (!pricing) pricing = snapshotCatalogPricing(model, job.payload, credits);
    await client.query(`update background_jobs set credits_cost=$2,credits_transaction_id=$3,
      billing_pricing=coalesce(billing_pricing,$4::jsonb),
      error_code=case when error_code='credit_reservation_failed' then null else error_code end,
      error_message=case when error_code='credit_reservation_failed' then null else error_message end,
      stage=case when stage='awaiting_credit_reservation' then 'queued' else stage end,updated_at=now() where id=$1`,
      [jobId, credits, transactionId, pricing ? JSON.stringify(pricing) : null]);
}
