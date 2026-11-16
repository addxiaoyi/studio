import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { assertWorkflowGenerationActive } from "../canvas-workflows/approval-access.js";
import { workflowBudgetError } from "../canvas-workflows/budget.js";
import { snapshotCatalogPricing } from "./pricing-snapshot.js";

export type GenerationApprovalState =
  | "confirmation_required"
  | "approved"
  | "rejected"
  | "expired";

export type GenerationApprovalRequest = {
  approvalId: string;
  jobType: "image_generation" | "video_generation";
  model: string;
  duration?: number;
  resolution?: string;
  hasReferenceImage: boolean;
  estimatedCredits: number;
  payloadFingerprint: string;
  expiresAt: string;
  parameters: Record<string, unknown>;
  context?: {
    canvasId?: string;
    sessionId?: string;
    threadId?: string;
    projectId?: string;
    websiteCaptureTaskId?: string;
    workflowGoalId?: string;
    workflowStepId?: string;
    reservationJobId?: string;
    requestKey?: string;
  };
  jobId?: string;
};

export class GenerationApprovalError extends Error {
  constructor(
    readonly code:
      | "generation_confirmation_required"
      | "generation_approval_invalid"
      | "generation_approval_expired"
      | "generation_approval_rejected",
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "GenerationApprovalError";
  }
}

type GateInput = {
  workspaceId: string;
  userId: string;
  jobType: "image_generation" | "video_generation";
  model: string;
  payload: Record<string, unknown>;
  estimatedCredits: number;
  approvalId?: string;
  forceConfirmation?: boolean;
  deferConsumption?: boolean;
  jobId?: string;
  idempotencyKey?: string;
  context?: GenerationApprovalRequest["context"];
};

export type GenerationApprovalGateResult =
  | { state: "approved"; approvalId?: string }
  | { state: "confirmation_required"; request: GenerationApprovalRequest };

export function createGenerationApprovalService(db: Pool) {
  return {
    async gate(input: GateInput): Promise<GenerationApprovalGateResult> {
      const fingerprint = fingerprintPayload({ payload: input.payload, estimatedCredits: input.estimatedCredits });
      if (input.approvalId) return consumeApproved(db, input, fingerprint);
      if (input.estimatedCredits <= 0 && !input.forceConfirmation) return { state: "approved" };
      const autoApprove = await db.query<{ enabled: boolean }>(
        "select auto_approve_paid_generation as enabled from workspace_settings where workspace_id = $1",
        [input.workspaceId],
      );
      if (autoApprove.rows[0]?.enabled && !input.forceConfirmation) return { state: "approved" };

      if (!input.approvalId && !input.forceConfirmation) {
        const previouslyApproved = await db.query<{ id: string }>(
          `select id from generation_approvals
           where workspace_id = $1 and user_id = $2 and job_type = $3
             and model = $4 and payload_fingerprint = $5
             and context=$6::jsonb
             and status = 'approved' and consumed_at is null and expires_at > now()
           order by approved_at desc nulls last limit 1`,
          [input.workspaceId, input.userId, input.jobType, input.model, fingerprint, JSON.stringify(input.context ?? {})],
        );
        if (previouslyApproved.rows[0]) return { state: "approved", approvalId: previouslyApproved.rows[0].id };
      }

      const approvalScope = [
        input.workspaceId,
        input.userId,
        input.jobType,
        input.model,
        fingerprint,
        JSON.stringify(input.context ?? {}),
      ];
      await db.query(
        `update generation_approvals set status = 'expired'
         where workspace_id = $1 and user_id = $2 and job_type = $3 and model = $4
           and payload_fingerprint = $5 and context=$6::jsonb
           and status = 'pending' and expires_at <= now()`,
        approvalScope,
      );
      const pending = await db.query<{ id: string; expires_at: string }>(
        `select id, expires_at from generation_approvals
         where workspace_id = $1 and user_id = $2 and job_type = $3 and model = $4
           and payload_fingerprint = $5 and context=$6::jsonb
           and status = 'pending' and expires_at > now()
         order by created_at desc limit 1`,
        approvalScope,
      );
      if (pending.rows[0]) {
        return {
          state: 'confirmation_required',
          request: toRequest(input, fingerprint, pending.rows[0].id, pending.rows[0].expires_at),
        };
      }

      let created: { rows: Array<{ id: string; expires_at: string }> };
      const catalogPricing = snapshotCatalogPricing(input.model, input.payload, input.estimatedCredits);
      try {
        created = await db.query(
          `insert into generation_approvals
            (workspace_id, user_id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, context, billing_pricing)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, now() + interval '10 minutes', $8::jsonb,
             coalesce((
               select case pm.billing_unit
                 when 'per_second' then jsonb_build_object('billingUnit','per_second',
                   'creditCost',$7::numeric/nullif(($5::jsonb->>'duration')::numeric,0))
                 when 'per_million_tokens' then jsonb_build_object('billingUnit','per_million_tokens',
                   'inputTokenPriceCny',pm.input_token_price_cny,'outputTokenPriceCny',pm.output_token_price_cny)
                 else jsonb_build_object('billingUnit','per_generation','creditCost',$7::numeric) end
               from provider_models pm join provider_configs pc on pc.id=pm.provider_id
               where pm.model_id=$4 and pm.enabled=true and pc.enabled=true and pc.health_status='healthy'
               order by pm.priority,pc.latency_ms nulls last limit 1
             ), $9::jsonb))
          returning id, expires_at`,
          [
            input.workspaceId,
            input.userId,
            input.jobType,
            input.model,
            JSON.stringify(input.payload),
            fingerprint,
            input.estimatedCredits,
            JSON.stringify(input.context ?? {}),
            catalogPricing ? JSON.stringify(catalogPricing) : null,
          ],
        );
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
        const raced = await db.query<{ id: string; expires_at: string }>(
          `select id, expires_at from generation_approvals
           where workspace_id = $1 and user_id = $2 and job_type = $3 and model = $4
             and payload_fingerprint = $5 and context=$6::jsonb
             and status = 'pending' and expires_at > now()
           order by created_at desc limit 1`,
          approvalScope,
        );
        if (!raced.rows[0]) throw error;
        return {
          state: 'confirmation_required',
          request: toRequest(input, fingerprint, raced.rows[0].id, raced.rows[0].expires_at),
        };
      }

      return {
        state: "confirmation_required",
        request: toRequest(input, fingerprint, created.rows[0]!.id, created.rows[0]!.expires_at),
      };
    },

    async approve(input: {
      approvalId: string;
      workspaceId: string;
      userId: string;
    }): Promise<GenerationApprovalRequest> {
      const existing = await db.query<ApprovalRow & { job_id?: string | null }>(
        `select id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, approved_at, status, consumed_at, context, job_id
         from generation_approvals where id = $1 and workspace_id = $2 and user_id = $3`,
        [input.approvalId, input.workspaceId, input.userId],
      );
      const prior = existing.rows[0];
      if (prior?.job_id && prior.status === "approved") return { ...toRequestFromRow(prior), jobId: prior.job_id };
      if (prior) await assertWorkflowGenerationActive(db, toRequestFromRow(prior));

      const row = await db.query<ApprovalRow>(
        `update generation_approvals
         set status = 'approved', approved_at = coalesce(approved_at, now())
         where id = $1 and workspace_id = $2 and user_id = $3
           and status = 'pending' and consumed_at is null and expires_at > now()
         returning id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, context`,
        [input.approvalId, input.workspaceId, input.userId],
      ).catch(cause => {
        const message = workflowBudgetError(cause);
        if (message) throw new GenerationApprovalError("generation_approval_invalid", message);
        throw cause;
      });
      if (row.rows[0]) {
        const approval = row.rows[0];
        return toRequestFromRow(approval);
      }

      const current = await db.query<ApprovalRow & { job_id?: string | null }>(
        `select id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, approved_at, status, consumed_at, context, job_id
         from generation_approvals where id = $1 and workspace_id = $2 and user_id = $3`,
        [input.approvalId, input.workspaceId, input.userId],
      );
      const approval = current.rows[0];
      if (!approval) throw new GenerationApprovalError("generation_approval_invalid", "This generation confirmation is not valid.");
      if (approval.job_id && approval.status === "approved") return { ...toRequestFromRow(approval), jobId: approval.job_id };
      if (approval.status === "approved" && approval.approved_at && new Date(approval.approved_at).getTime() < new Date(approval.expires_at).getTime()) return toRequestFromRow(approval);
      if (new Date(approval.expires_at).getTime() <= Date.now()) {
        await expire(db, input.approvalId);
        throw new GenerationApprovalError("generation_approval_expired", "This generation confirmation has expired.");
      }
      if (approval.status === "rejected") throw new GenerationApprovalError("generation_approval_rejected", "This generation confirmation was cancelled.");
      if (approval.status !== "approved") throw new GenerationApprovalError("generation_approval_invalid", "This generation confirmation is not approved.");
      return toRequestFromRow(approval);
    },

    async attachJob(approvalId: string, jobId: string) {
      const client = await db.connect();
      try {
        await client.query("begin");
        const job = (await client.query<{ billing_approval_id: string | null; credits_transaction_id: string | null }>(
          "select billing_approval_id,credits_transaction_id from background_jobs where id=$1 for update", [jobId],
        )).rows[0];
        if (!job || (job.credits_transaction_id && job.billing_approval_id && job.billing_approval_id !== approvalId)) {
          await client.query("rollback");
          return null;
        }
        const { rows } = await client.query<{ job_id: string }>(
        `update generation_approvals approval set job_id=coalesce(approval.job_id,$2),consumed_at=coalesce(approval.consumed_at,now())
         where approval.id=$1 and approval.status='approved' and (approval.job_id is null or approval.job_id=$2)
           and exists(select 1 from background_jobs job where job.id=$2 and job.workspace_id=approval.workspace_id
             and job.created_by=approval.user_id and job.job_type=approval.job_type and job.payload=approval.payload
             and job.canvas_id::text is not distinct from approval.context->>'canvasId'
             and job.session_id::text is not distinct from approval.context->>'sessionId'
             and job.project_id::text is not distinct from approval.context->>'projectId'
             and job.thread_id is not distinct from approval.context->>'threadId'
             and (job.credits_transaction_id is null or approval.estimated_credits=
               coalesce((job.billing_receipt->>'reservedCredits')::numeric,job.credits_cost))
             and (approval.context->>'reservationJobId' is null or approval.context->>'reservationJobId'=job.id::text)
             and (approval.context->>'requestKey' is null or approval.context->>'requestKey'=job.idempotency_key))
         returning approval.job_id`,
        [approvalId, jobId],
      );
        if (!rows[0]) {
          await client.query("rollback");
          return null;
        }
        await client.query("update background_jobs set billing_approval_id=$2 where id=$1", [jobId, approvalId]);
        await client.query("commit");
        return rows[0].job_id;
      } catch (cause) {
        await client.query("rollback");
        throw cause;
      } finally { client.release(); }
    },

    async reject(input: { approvalId: string; workspaceId: string; userId: string }) {
      const rejected = await db.query<{ id: string }>(
        `update generation_approvals set status = 'rejected', rejected_at = now()
         where id = $1 and workspace_id = $2 and user_id = $3 and status = 'pending' and consumed_at is null
         returning id`,
        [input.approvalId, input.workspaceId, input.userId],
      );
      if (rejected.rows[0]) return;
      const current = await db.query<{ status: string }>(
        "select status from generation_approvals where id = $1 and workspace_id = $2 and user_id = $3",
        [input.approvalId, input.workspaceId, input.userId],
      );
      if (current.rows[0]?.status === "rejected") return;
      throw new GenerationApprovalError("generation_approval_invalid", "报价已确认、已过期或不存在，请恢复任务核对当前状态。");
    },
  };
}

type ApprovalRow = {
  id: string;
  job_type: "image_generation" | "video_generation";
  model: string;
  payload: Record<string, unknown>;
  payload_fingerprint: string;
  estimated_credits: number;
  expires_at: string;
  approved_at?: string | null;
  status?: GenerationApprovalState;
  consumed_at?: string | null;
  context?: GenerationApprovalRequest["context"];
};

async function consumeApproved(
  db: Pool,
  input: GateInput,
  fingerprint: string,
): Promise<GenerationApprovalGateResult> {
  const approvalId = input.approvalId;
  if (!approvalId) throw new GenerationApprovalError("generation_approval_invalid", "A confirmation id is required.");
  if (input.deferConsumption) {
    const approved = await db.query<{ id: string }>(
      `select approval.id from generation_approvals approval
       where approval.id=$1 and approval.workspace_id=$2 and approval.user_id=$3 and approval.job_type=$4
         and approval.model=$5 and approval.payload_fingerprint=$6 and approval.status='approved'
         and approval.expires_at>now()
         and (approval.context-'reservationJobId')=($7::jsonb-'reservationJobId')
         and (approval.context->>'reservationJobId' is null or approval.context->>'reservationJobId'=$8::text)
         and (approval.consumed_at is null or exists(select 1 from background_jobs job where job.id=approval.job_id
           and job.workspace_id=$2 and job.created_by=$3 and job.job_type=$4 and job.payload=approval.payload
           and (job.id=$8::uuid or ($9::text is not null and job.idempotency_key=$9)
             or ($8::uuid is null and $9::text is null and job.idempotency_key='approval:'||approval.id::text))))`,
      [approvalId,input.workspaceId,input.userId,input.jobType,input.model,fingerprint,JSON.stringify(input.context ?? {}),
        input.jobId ?? null,input.idempotencyKey ?? null],
    );
    if (approved.rows[0]) return { state: "approved", approvalId };
    throw new GenerationApprovalError("generation_approval_invalid", "确认已过期、参数已变化或已用于另一任务，请重新确认。");
  }
  const consumed = await db.query<{ id: string }>(
    `update generation_approvals
     set consumed_at = now()
     where id = $1 and workspace_id = $2 and user_id = $3
       and job_type = $4 and model = $5 and payload_fingerprint = $6
       and status = 'approved' and consumed_at is null and expires_at > now() and context=$7::jsonb
     returning id`,
    [approvalId, input.workspaceId, input.userId, input.jobType, input.model, fingerprint, JSON.stringify(input.context ?? {})],
  );
  if (consumed.rows[0]) return { state: "approved", approvalId };

  const row = await db.query<{ status: string; expires_at: string }>(
    "select status, expires_at from generation_approvals where id = $1 and workspace_id = $2 and user_id = $3",
    [approvalId, input.workspaceId, input.userId],
  );
  if (!row.rows[0] || row.rows[0].status === "rejected") {
    throw new GenerationApprovalError("generation_approval_invalid", "This generation confirmation is not valid.");
  }
  if (row.rows[0].status === "pending") {
    throw new GenerationApprovalError("generation_confirmation_required", "Confirm this generation before submitting it.");
  }
  if (new Date(row.rows[0].expires_at).getTime() <= Date.now()) {
    await expire(db, approvalId);
    throw new GenerationApprovalError("generation_approval_expired", "This generation confirmation has expired.");
  }
  throw new GenerationApprovalError("generation_approval_invalid", "The generation parameters changed; please confirm again.");
}

async function expire(db: Pool, approvalId: string) {
  // The submission deadline cannot revoke the quote funding an existing task.
  await db.query(`update generation_approvals set status = 'expired'
    where id = $1 and status in ('pending','approved') and consumed_at is null and job_id is null`, [approvalId]);
}

function toRequest(input: GateInput, payloadFingerprint: string, approvalId: string, expiresAt: string): GenerationApprovalRequest {
  return {
    approvalId,
    jobType: input.jobType,
    model: input.model,
    ...(typeof input.payload.duration === "number" ? { duration: input.payload.duration } : {}),
    ...(typeof input.payload.resolution === "string" ? { resolution: input.payload.resolution } : {}),
    hasReferenceImage: hasReferenceImage(input.payload),
    estimatedCredits: input.estimatedCredits,
    payloadFingerprint,
    expiresAt,
    parameters: input.payload,
    ...(input.context ? { context: input.context } : {}),
  };
}

function toRequestFromRow(row: ApprovalRow): GenerationApprovalRequest {
  return {
    approvalId: row.id,
    jobType: row.job_type,
    model: row.model,
    ...(typeof row.payload.duration === "number" ? { duration: row.payload.duration } : {}),
    ...(typeof row.payload.resolution === "string" ? { resolution: row.payload.resolution } : {}),
    hasReferenceImage: hasReferenceImage(row.payload),
    estimatedCredits: Number(row.estimated_credits),
    payloadFingerprint: row.payload_fingerprint,
    expiresAt: row.expires_at,
    parameters: row.payload,
    ...(row.context ? { context: row.context } : {}),
    ...(typeof (row as ApprovalRow & { job_id?: unknown }).job_id === "string" ? { jobId: (row as ApprovalRow & { job_id: string }).job_id } : {}),
  };
}

function hasReferenceImage(payload: Record<string, unknown>) {
  return ["input_images", "input_asset_ids", "input_video", "reference_image", "first_frame"]
    .some((key) => Array.isArray(payload[key]) ? payload[key].length > 0 : Boolean(payload[key]));
}

export function fingerprintPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
