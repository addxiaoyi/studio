import { z } from "zod";
import { workflowGraphSchema, type WorkflowGraph } from "./canvas-workflow.js";
export const workflowAssistantActionSchema = z.enum([
  "edit",
  "run",
  "pause",
  "resume",
  "cancel",
  "retry",
  "inspect",
]);
export const workflowAssistantPlanSchema = z
  .object({
    action: workflowAssistantActionSchema,
    summary: z.string().trim().min(1).max(2000),
    graph: workflowGraphSchema.optional(),
    targetNodeId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  })
  .strict();
export type WorkflowAssistantPlan = z.infer<typeof workflowAssistantPlanSchema>;
export const workflowProposalSchema = z.object({
  id: z.string().uuid(),
  canvasId: z.string().uuid(),
  workflowId: z.string().uuid().nullable(),
  revision: z.number().nullable(),
  goalId: z.string().uuid().nullable(),
  prompt: z.string(),
  action: workflowAssistantActionSchema,
  targetNodeId: z.string().optional(),
  summary: z.string(),
  before: z.nullable(workflowGraphSchema),
  graph: z.nullable(workflowGraphSchema),
  status: z.enum(["pending", "applied", "rejected"]),
  expiresAt: z.string(),
  createdAt: z.string(),
  result: z.record(z.string(), z.unknown()).nullable(),
});
export type WorkflowProposal = z.infer<typeof workflowProposalSchema>;
export const WORKFLOW_ACTION_LABELS = {
  edit: "修改流程",
  run: "运行流程",
  pause: "暂停运行",
  resume: "继续运行",
  cancel: "取消运行",
  retry: "重试未完成步骤",
  inspect: "查看状态",
} as const;
export function workflowChanges(
  before: WorkflowGraph | null,
  after: WorkflowGraph | null,
) {
  if (!after) return [];
  const changes: Array<{
    kind: "add" | "remove" | "change" | "connect" | "disconnect";
    title: string;
    detail: string;
  }> = [];
  const old = new Map((before?.nodes ?? []).map((node) => [node.id, node]));
  for (const node of after.nodes) {
    const prior = old.get(node.id);
    if (!prior) {
      changes.push({ kind: "add", title: node.title, detail: "新增节点" });
      continue;
    }
    const keys = Object.keys(node.config).filter(
      (key) =>
        key !== "kind" &&
        JSON.stringify((node.config as Record<string, unknown>)[key]) !==
          JSON.stringify((prior.config as Record<string, unknown>)[key]),
    );
    const moved =
      prior.position.x !== node.position.x ||
      prior.position.y !== node.position.y;
    const noteChanged=prior.note!==node.note,pinChanged=JSON.stringify(prior.pin)!==JSON.stringify(node.pin);
    if (
      keys.length ||
      prior.title !== node.title ||
      prior.config.kind !== node.config.kind ||
      moved || noteChanged || pinChanged
    )
      changes.push({
        kind: "change",
        title: node.title,
        detail:
          [
            ...keys.map(
              (key) =>
                (
                  ({
                    prompt: "提示词",
                    model: "模型",
                    text: "创作资料",
                    instruction: "创作要求",
                    duration: "时长",
                    at: "取帧时间",
                    url: "网址",
                    record: "录制模式",
                    pageLimit: "页面数量",
                    aspect: "画幅",
                    aspectRatio: "画幅",
                    start: "开始时间",
                    end: "结束时间",
                    shotCount: "镜头数量",
                    resolution: "分辨率",
                    conditions:"判断条件",match:"条件组合",json:"JSON 数据",path:"字段路径",operation:"文字处理方式",template:"文字模板",separator:"合并分隔符",seconds:"等待时间",search:"查找文字",replacement:"替换文字",
                  }) as Record<string, string>
                )[key] ?? key,
            ),
            ...(moved ? ["节点位置"] : []),
            ...(noteChanged?["节点备注"]:[]),...(pinChanged?[node.pin?"固定成功结果，跳过上游生成":"取消固定，下次重新执行"]:[]),
          ].join("、") || "名称或节点类型",
      });
  }
  for (const node of before?.nodes ?? [])
    if (!after.nodes.some((item) => item.id === node.id))
      changes.push({
        kind: "remove",
        title: node.title,
        detail: "移除节点及其连接",
      });
  const label = (id: string) =>
    after.nodes.find((node) => node.id === id)?.title ??
    old.get(id)?.title ??
    id;
  for (const edge of after.edges)
    if (
      !before?.edges.some(
        (prior) => prior.source === edge.source && prior.target === edge.target,
      )
    )
      changes.push({
        kind: "connect",
        title: `${label(edge.source)} → ${label(edge.target)}`,
        detail: "新增连接",
      });
  for(const edge of after.edges){const prior=before?.edges.find(item=>item.id===edge.id);if(prior&&prior.branch!==edge.branch)changes.push({kind:"change",title:`${label(edge.source)} → ${label(edge.target)}`,detail:`IF 分支改为${edge.branch==="true"?"是":edge.branch==="false"?"否":"普通连接"}`});}
  if(JSON.stringify(before?.groups??[])!==JSON.stringify(after.groups??[]))changes.push({kind:"change",title:"节点分组",detail:"更新分组、备注或折叠状态"});
  for (const edge of before?.edges ?? [])
    if (
      !after.edges.some(
        (next) => next.source === edge.source && next.target === edge.target,
      )
    )
      changes.push({
        kind: "disconnect",
        title: `${label(edge.source)} → ${label(edge.target)}`,
        detail: "断开连接",
      });
  if (before && before.title !== after.title)
    changes.push({
      kind: "change",
      title: after.title,
      detail: "修改流程名称",
    });
  if (
    before &&
    before.edges.length === after.edges.length &&
    before.edges.every((edge) =>
      after.edges.some(
        (next) => next.source === edge.source && next.target === edge.target,
      ),
    ) &&
    JSON.stringify(before.edges.map((edge) => [edge.source, edge.target])) !==
      JSON.stringify(after.edges.map((edge) => [edge.source, edge.target]))
  )
    changes.push({
      kind: "change",
      title: "输入顺序",
      detail: "调整镜头或资料的输入顺序",
    });
  return changes;
}
