import type { Pool } from "pg";
import {
  CONFIGURED_PRICE_MULTIPLIER,
  TOKEN_BILLING_RESERVE_CREDITS,
  type GoalCommand,
} from "@helstera/shared";
import { resolveConfiguredModel } from "../../http/model-availability.js";
import { buildMediaRoute } from "../media/media-routing.js";
import { createGenerationApprovalService } from "../generation/generation-approval-service.js";
import { assertConnectorEnabled } from "../agent-goals/connector-gate.js";
import {
  StepWaiting,
  StepCanceled,
  type StepExecution,
} from "../agent-goals/goal-step-worker.js";
import { createLocalCostGuard } from "../credits/tier-guard.js";
import { assertWorkflowReferenceAssets } from "./reference-access.js";

type Generate = Extract<GoalCommand, { executor: "media.generate" }>;
export async function executeWorkflowGeneration(
  db: Pool,
  input: StepExecution,
  command: Generate,
) {
  const { goal, step, previous } = input;
  await assertConnectorEnabled(
    db,
    goal.workspace_id,
    goal.created_by,
    "media-generation",
  );
  const prior = (
    await db.query<{
      id: string;
      status: string;
      job_id: string | null;
      expires_at: Date;
    }>(
      "select id,status,job_id,expires_at from generation_approvals where workspace_id=$1 and user_id=$2 and context->>'workflowStepId'=$3 order by created_at desc limit 1",
      [goal.workspace_id, goal.created_by, step.id],
    )
  ).rows[0];
  if (prior?.status === "rejected")
    throw new StepCanceled("你已拒绝此节点的生成费用，流程已停止。");
  if (
    prior?.status === "pending" &&
    new Date(prior.expires_at).getTime() > Date.now() &&
    step.output?.generationApproval
  )
    throw new StepWaiting(step.output, "waiting_approval");
  if (prior?.job_id) {
    const job = (
      await db.query<{
        status: string;
        progress: number;
        stage: string;
        error_message: string;
        result: Record<string, unknown>;
      }>(
        "select status,progress,stage,error_message,result from background_jobs where id=$1 and workspace_id=$2 and created_by=$3",
        [prior.job_id, goal.workspace_id, goal.created_by],
      )
    ).rows[0];
    if (!job) throw new Error("生成任务不可用，停止继续执行。");
    if (
      ["failed", "canceled", "dead_letter", "sync_failed"].includes(job.status)
    )
      throw new Error(
        job.error_message || "生成没有完成，请在任务中核验后重试。",
      );
    if (job.status !== "succeeded")
      throw new StepWaiting({
        ...step.output,
        generationJob: {
          id: prior.job_id,
          status: job.status,
          progress: job.progress,
          stage: job.stage,
        },
      });
    const assetId = job.result?.asset_id;
    if (typeof assetId !== "string")
      throw new Error("生成任务缺少素材回执，不能继续。");
    const asset = (
      await db.query(
        "select ao.id from asset_objects ao left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path where ao.id=$1 and ao.workspace_id=$2 and ao.created_by=$3 and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))",
        [assetId, goal.workspace_id, goal.created_by],
      )
    ).rows[0];
    if (!asset) throw new Error("生成素材已失效或权限已撤销。");
    return {
      assets: [
        {
          id: assetId,
          mediaType: command.mediaType,
          url: `/api/uploads/${assetId}/file`,
        },
      ],
      ...(command.mediaType === "video" ? { recordingAssetId: assetId } : {}),
      canvasElementIds:
        typeof job.result.canvas_element_id === "string"
          ? [job.result.canvas_element_id]
          : [],
      generationJobId: prior.job_id,
      model: command.model,
    };
  }
  if (prior?.status === "approved")
    throw new StepWaiting({
      ...step.output,
      generationPending: "正在创建已确认任务",
    });
  const sources = command.sources.map(id => {
    const source = previous.find(item => item.step_id === id)?.output;
    if (!source) throw new Error("上游参考资料缺少完成回执，生成已停止。");
    if (Array.isArray(source.assets) && source.assets.some((asset: { mediaType?: unknown }) => asset.mediaType === "video"))
      throw new Error("视频参考需要先连接抽帧节点，不能忽略视频直接生成。");
    return source;
  });
  const text = sources
    .map((source) => (typeof source?.text === "string" ? source.text : ""))
    .filter(Boolean)
    .join("\n\n");
  const imageIds = [
    ...new Set(
      sources.flatMap((source) =>
        Array.isArray(source?.assets)
          ? (source.assets as Array<{ id?: unknown; mediaType?: unknown }>)
              .filter(
                (asset) =>
                  asset.mediaType === "image" && typeof asset.id === "string",
              )
              .map((asset) => asset.id as string)
          : [],
      ),
    ),
  ];
  if (imageIds.length > 6) throw new Error("当前生成节点最多接入6张参考图片。");
  await assertWorkflowReferenceAssets(db, { workspaceId: goal.workspace_id, userId: goal.created_by }, imageIds);
  const model = await resolveConfiguredModel(
    db,
    command.mediaType,
    command.model,
    {
      strictRequested: true,
      allowUnverified: true,
      requiresInputImage: imageIds.length > 0,
      ...(command.mediaType === "video"
        ? { requiredDuration: command.duration }
        : {}),
    },
  );
  if (!model)
    throw new Error("所选模型不可用或不支持当前参考素材，请更换模型。");
  const prompt = [command.prompt, text].filter(Boolean).join("\n\n").trim();
  if (!prompt || prompt.length > 16000)
    throw new Error("生成提示词为空或过长，请调整创作资料。");
  const cost =
    model.billing_unit === "per_million_tokens"
      ? TOKEN_BILLING_RESERVE_CREDITS
      : model.billing_unit === "per_second"
        ? await createLocalCostGuard(db).calculateCreditCost(
            model.model_id,
            "video_generation",
            { duration: command.duration, resolution: command.resolution },
          )
        : Number(model.price_credits) * CONFIGURED_PRICE_MULTIPLIER;
  if (!Number.isFinite(cost) || cost < 0)
    throw new Error("模型尚未配置有效价格。");
  const route = buildMediaRoute({
    intent: {
      mediaType: command.mediaType,
      inputImageCount: imageIds.length,
      inputVideo: false,
      enableAudio: false,
      requestedModel: model.model_id,
      selectionMode: "manual",
      ...(command.mediaType === "video" ? { durationSeconds: command.duration, resolution: command.resolution } : {}),
    },
    selected: model,
    candidates: [model.model_id],
  });
  const payload = {
    prompt,
    model: model.model_id,
    title: step.title,
    aspect_ratio: command.aspectRatio,
    input_asset_ids: imageIds,
    routing: route,
    workflow_step_id: step.id,
    ...(command.mediaType === "video"
      ? {
          duration: command.duration,
          resolution: command.resolution,
          enable_audio: false,
        }
      : {}),
  };
  await input.assertActive();
  const gate = await createGenerationApprovalService(db).gate({
    workspaceId: goal.workspace_id,
    userId: goal.created_by,
    jobType:
      command.mediaType === "image" ? "image_generation" : "video_generation",
    model: model.model_id,
    payload,
    estimatedCredits: cost,
    forceConfirmation: true,
    context: {
      ...(goal.canvas_id ? { canvasId: goal.canvas_id } : {}),
      ...(goal.chat_session_id ? { sessionId: goal.chat_session_id } : {}),
      workflowGoalId: goal.id,
      workflowStepId: step.id,
    },
  });
  if (gate.state !== "confirmation_required")
    throw new Error("生成必须逐次确认，尚未执行。");
  const { parameters: _parameters, ...approval } = gate.request;
  throw new StepWaiting(
    {
      generationApproval: approval,
      generationPreview: {
        prompt,
        inputAssetIds: imageIds,
        mediaType: command.mediaType,
        aspectRatio: command.aspectRatio,
      },
    },
    "waiting_approval",
  );
}
