import {
  CONFIGURED_PRICE_MULTIPLIER,
  type WorkflowGraph,
  type WorkflowPreflight,
  compileWorkflow,
  prunePinnedAncestors,
  validateWorkflow,
  workflowRunGraph,
  workflowValueKinds,
} from "@helstera/shared";
import type { Pool } from "pg";
import {
  isWithinPublicModelPriceLimit,
  resolveConfiguredModel,
} from "../../http/model-availability.js";
import { createLocalCostGuard } from "../credits/tier-guard.js";
import { readWorkflowMaterial } from "./materials.js";
import { readPinnedOutput } from "./pins.js";
import { WorkflowResourceError } from "./resource-error.js";
import type { WorkflowAuthorCheck, WorkflowAuthorHealth } from "./author-health.js";

type Scope = {
  canvasId: string;
  workspaceId: string;
  userId: string;
  workflowId: string;
};

export async function inspectWorkflow(
  db: Pick<Pool, "query">,
  graph: WorkflowGraph,
  scope: Scope,
  revision: number,
  targetNodeId?: string,
  authorCheck?: WorkflowAuthorCheck,
): Promise<WorkflowPreflight> {
  const issues: WorkflowPreflight["issues"] = [];
  const quotes: WorkflowPreflight["quotes"] = [];
  let authorHealth: WorkflowAuthorHealth | null = null;
  let execution: WorkflowGraph;
  try {
    execution = prunePinnedAncestors(workflowRunGraph(graph, targetNodeId));
  } catch (cause) {
    return {
      revision,
      ready: false,
      quotes,
      issues: [
        {
          nodeId: targetNodeId ?? null,
          title: "执行范围",
          code: "structure",
          message: cause instanceof Error ? cause.message : "执行范围无效。",
          action: "调整目标节点或连线",
        },
      ],
    };
  }
  for (const issue of validateWorkflow(execution)) {
    issues.push({
      nodeId: issue.nodeId ?? null,
      title:
        execution.nodes.find((node) => node.id === issue.nodeId)?.title ??
        "流程结构",
      code: "structure",
      message: issue.message,
      action: "完善节点参数或连线",
    });
  }
  if (!issues.length) {
    try {
      compileWorkflow(execution);
    } catch (cause) {
      issues.push({
        nodeId: null,
        title: "执行方案",
        code: "structure",
        message: cause instanceof Error ? cause.message : "执行方案无法编译。",
        action: "检查固定结果和执行连线",
      });
    }
  }
  for (const node of execution.nodes) {
    const add = (
      code: WorkflowPreflight["issues"][number]["code"],
      message: string,
      action: string,
    ) =>
      issues.push({
        nodeId: node.id,
        title: node.title,
        code,
        message,
        action,
      });
    if (!node.pin && node.config.kind === "write") {
      authorHealth ??= authorCheck ? await authorCheck(scope) : { ready: false, message: "编剧连接检查尚未配置。" };
      if (!authorHealth.ready) add("author", authorHealth.message, "检查编剧模型、服务地址和凭据");
    }
    if (node.pin || node.config.kind === "asset") {
      try {
        if (node.pin) await readPinnedOutput(db, node, scope);
        else if (node.config.kind === "asset")
          await readWorkflowMaterial(db, { ...scope, ...node.config });
      } catch (cause) {
        if (!(cause instanceof WorkflowResourceError)) throw cause;
        add(
          node.pin ? "pin" : "material",
          cause.message,
          node.pin ? "取消固定并重新执行" : "重新选择素材并保存画布",
        );
      }
    }
    if (node.pin || node.config.kind !== "generate") continue;
    const config = node.config;
    if (!config.model.trim()) continue;
    const inputs = execution.edges.filter((edge) => edge.target === node.id);
    const kinds = new Set(
      inputs.flatMap((edge) => [...workflowValueKinds(execution, edge.source)]),
    );
    if (kinds.has("video")) {
      add("material", "视频参考需要先连接抽帧节点。", "先抽帧，再连接生成节点");
    }
    const model = await resolveConfiguredModel(
      db,
      config.mediaType,
      config.model,
      {
        strictRequested: true,
        allowUnverified: true,
        readOnly: true,
        includeInvalidPrices: true,
        requiresInputImage: kinds.has("image"),
        ...(config.mediaType === "video"
          ? { requiredDuration: config.duration }
          : {}),
      },
    );
    if (!model) {
      add(
        "model",
        "所选模型不可用或不支持当前素材、时长。",
        "更换可用且兼容的生成模型",
      );
      continue;
    }
    if (model.billing_unit === "per_million_tokens") {
      add(
        "price",
        "此模型按实际用量结算，无法保证流程预算上限。",
        "选择固定价格模型",
      );
      continue;
    }
    if (!isWithinPublicModelPriceLimit(model)) {
      add(
        "price",
        "模型价格无效或超出支持范围。",
        "更换模型，或检查模型价格配置",
      );
      continue;
    }
    const credits =
      model.billing_unit === "per_second"
        ? await createLocalCostGuard(db).calculateCreditCost(
            model.model_id,
            "video_generation",
            {
              duration: config.duration,
              resolution: config.resolution,
            },
          )
        : Number(model.price_credits) * CONFIGURED_PRICE_MULTIPLIER;
    if (!Number.isFinite(credits) || credits < 0) {
      add("price", "模型尚未配置有效价格。", "更换模型，或检查模型价格配置");
      continue;
    }
    quotes.push({
      nodeId: node.id,
      title: node.title,
      model: model.model_id,
      credits,
    });
  }
  const distinct = [
    ...new Map(
      issues.map((issue) => [
        JSON.stringify([issue.nodeId, issue.code, issue.message]),
        issue,
      ]),
    ).values(),
  ];
  return { revision, ready: distinct.length === 0, issues: distinct, quotes };
}
