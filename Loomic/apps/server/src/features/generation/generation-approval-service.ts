import { createHash } from "node:crypto";
import type { Pool } from "pg";

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
  context?: GenerationApprovalRequest["context"];
};

export type GenerationApprovalGateResult =
  | { state: "approved"; approvalId?: string }
  | { state: "confirmation_required"; request: GenerationApprovalRequest };

export function createGenerationApprovalService(db: Pool) {
  return {
    async gate(input: GateInput): Promise<GenerationApprovalGateResult> {
      if (input.estimatedCredits <= 0) return { state: "approved" };

      const fingerprint = fingerprintPayload(input.payload);
      const autoApprove = await db.query<{ enabled: boolean }>(
        "select auto_approve_paid_generation as enabled from workspace_settings where workspace_id = $1",
        [input.workspaceId],
      );
      if (autoApprove.rows[0]?.enabled) return { state: "approved" };

      if (!input.approvalId) {
        const previouslyApproved = await db.query<{ id: string }>(
          `select id from generation_approvals
           where workspace_id = $1 and user_id = $2 and job_type = $3
             and model = $4 and payload_fingerprint = $5
             and context->>'canvasId' is not distinct from $6
             and context->>'sessionId' is not distinct from $7
             and status = 'approved' and consumed_at is null and expires_at > now()
           order by approved_at desc nulls last limit 1`,
          [input.workspaceId, input.userId, input.jobType, input.model, fingerprint, input.context?.canvasId ?? null, input.context?.sessionId ?? null],
        );
        if (previouslyApproved.rows[0]) return { state: "approved", approvalId: previouslyApproved.rows[0].id };
      }

      if (input.approvalId) {
        return consumeApproved(db, input, fingerprint);
      }

      const approvalScope = [
        input.workspaceId,
        input.userId,
        input.jobType,
        input.model,
        fingerprint,
        input.context?.canvasId ?? null,
        input.context?.sessionId ?? null,
      ];
      await db.query(
        `update generation_approvals set status = 'expired'
         where workspace_id = $1 and user_id = $2 and job_type = $3 and model = $4
           and payload_fingerprint = $5 and context->>'canvasId' is not distinct from $6
           and context->>'sessionId' is not distinct from $7
           and status = 'pending' and expires_at <= now()`,
        approvalScope,
      );
      const pending = await db.query<{ id: string; expires_at: string }>(
        `select id, expires_at from generation_approvals
         where workspace_id = $1 and user_id = $2 and job_type = $3 and model = $4
           and payload_fingerprint = $5 and context->>'canvasId' is not distinct from $6
           and context->>'sessionId' is not distinct from $7
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
      try {
        created = await db.query(
          `insert into generation_approvals
            (workspace_id, user_id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, context)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, now() + interval '10 minutes', $8::jsonb)
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
          ],
        );
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
        const raced = await db.query<{ id: string; expires_at: string }>(
          `select id, expires_at from generation_approvals
           where workspace_id = $1 and user_id = $2 and job_type = $3 and model = $4
             and payload_fingerprint = $5 and context->>'canvasId' is not distinct from $6
             and context->>'sessionId' is not distinct from $7
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
        `select id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, status, consumed_at, context, job_id
         from generation_approvals where id = $1 and workspace_id = $2 and user_id = $3`,
        [input.approvalId, input.workspaceId, input.userId],
      );
      const prior = existing.rows[0];
      if (prior?.job_id) return { ...toRequestFromRow(prior), jobId: prior.job_id };

      const row = await db.query<ApprovalRow>(
        `update generation_approvals
         set status = 'approved', approved_at = coalesce(approved_at, now())
         where id = $1 and workspace_id = $2 and user_id = $3
           and status = 'pending' and consumed_at is null
         returning id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, context`,
        [input.approvalId, input.workspaceId, input.userId],
      );
      if (row.rows[0]) {
        const approval = row.rows[0];
        if (new Date(approval.expires_at).getTime() <= Date.now()) {
          await expire(db, input.approvalId);
          throw new GenerationApprovalError("generation_approval_expired", "This generation confirmation has expired.");
        }
        return toRequestFromRow(approval);
      }

      const current = await db.query<ApprovalRow & { job_id?: string | null }>(
        `select id, job_type, model, payload, payload_fingerprint, estimated_credits, expires_at, status, consumed_at, context, job_id
         from generation_approvals where id = $1 and workspace_id = $2 and user_id = $3`,
        [input.approvalId, input.workspaceId, input.userId],
      );
      const approval = current.rows[0];
      if (!approval) throw new GenerationApprovalError("generation_approval_invalid", "This generation confirmation is not valid.");
      if (approval.job_id) return { ...toRequestFromRow(approval), jobId: approval.job_id };
      if (new Date(approval.expires_at).getTime() <= Date.now()) {
        await expire(db, input.approvalId);
        throw new GenerationApprovalError("generation_approval_expired", "This generation confirmation has expired.");
      }
      if (approval.status === "rejected") throw new GenerationApprovalError("generation_approval_rejected", "This generation confirmation was cancelled.");
      if (approval.status !== "approved") throw new GenerationApprovalError("generation_approval_invalid", "This generation confirmation is not approved.");
      return toRequestFromRow(approval);
    },

    async attachJob(approvalId: string, jobId: string) {
      await db.query(
        "update generation_approvals set job_id = coalesce(job_id, $2), consumed_at = coalesce(consumed_at, now()) where id = $1 and status = 'approved'",
        [approvalId, jobId],
      );
      const { rows } = await db.query<{ job_id: string | null }>("select job_id from generation_approvals where id = $1", [approvalId]);
      return rows[0]?.job_id ?? null;
    },

    async reject(input: { approvalId: string; workspaceId: string; userId: string }) {
      await db.query(
        `update generation_approvals set status = 'rejected', rejected_at = now()
         where id = $1 and workspace_id = $2 and user_id = $3 and status = 'pending' and consumed_at is null`,
        [input.approvalId, input.workspaceId, input.userId],
      );
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
  const consumed = await db.query<{ id: string }>(
    `update generation_approvals
     set consumed_at = now()
     where id = $1 and workspace_id = $2 and user_id = $3
       and job_type = $4 and model = $5 and payload_fingerprint = $6
       and status = 'approved' and consumed_at is null and expires_at > now()
     returning id`,
    [approvalId, input.workspaceId, input.userId, input.jobType, input.model, fingerprint],
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
  await db.query("update generation_approvals set status = 'expired' where id = $1 and status in ('pending','approved')", [approvalId]);
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
