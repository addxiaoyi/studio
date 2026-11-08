import { z } from "zod";
import { creativeNodeConfigs } from "./creative-workflow.js";
import {
  goalExecutionPlanSchema,
  type GoalExecutionPlan,
  type GoalExecutionStep,
} from "./goal-execution.js";

const nodeId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const workflowNodeSchema = z
  .object({
    id: nodeId,
    title: z.string().trim().min(1).max(100),
    position: z.object({
      x: z.number().finite().min(-1000000).max(1000000),
      y: z.number().finite().min(-1000000).max(1000000),
    }),
    config: z.discriminatedUnion("kind", [
      ...creativeNodeConfigs,
      z.object({ kind: z.literal("asset"), elementId: z.string().max(200), assetId: z.union([z.string().uuid(),z.literal("")]), mediaType: z.enum(["image", "video"]) }).strict(),
      z.object({ kind: z.literal("url"), url: z.string().max(2048) }).strict(),
      z
        .object({ kind: z.literal("search"), query: z.string().max(500) })
        .strict(),
      z
        .object({
          kind: z.literal("capture"),
          record: z.boolean(),
          pageLimit: z.number().int().min(1).max(5),
        })
        .strict(),
      z
        .object({
          kind: z.literal("trim"),
          start: z.number().finite().min(0).max(7200),
          end: z.number().finite().min(0).max(7200),
          aspect: z.enum(["original", "portrait", "landscape"]),
        })
        .strict(),
      z.object({ kind: z.literal("deliver") }).strict(),
    ]),
  })
  .strict();
export const workflowGraphSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    nodes: z.array(workflowNodeSchema).max(24),
    edges: z
      .array(z.object({ id: nodeId, source: nodeId, target: nodeId }).strict())
      .max(40),
  })
  .strict();
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type WorkflowIssue = { nodeId?: string; message: string };
export const workflowDocumentSchema = z.object({
  id: z.string().uuid(),
  canvasId: z.string().uuid(),
  revision: z.number().int().positive(),
  graph: workflowGraphSchema,
  activeGoalId: z.string().uuid().nullable(),
  updatedAt: z.string(),
});
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;

export const WORKFLOW_LABELS: Record<WorkflowNode["config"]["kind"], string> = {
  text: "创作资料", write: "AI 编剧", shot: "分镜镜头", generate: "图片 / 视频生成", compose: "镜头合成", frame: "视频抽帧",
  asset: "画布素材",
  url: "网址输入",
  search: "网页搜索",
  capture: "浏览与录制",
  trim: "视频裁剪",
  deliver: "输出到画布",
};
export function connectionIssue(
  graph: WorkflowGraph,
  sourceId: string,
  targetId: string,
): string | null {
  const source = graph.nodes.find((node) => node.id === sourceId),
    target = graph.nodes.find((node) => node.id === targetId);
  if (!source || !target || sourceId === targetId)
    return "不能连接自身或不存在的节点。";
  const a = source.config,
    b = target.config;
  const text = ["text", "write", "shot"].includes(a.kind);
  const image = a.kind === "asset" && a.mediaType === "image" || a.kind === "generate" && a.mediaType === "image" || a.kind === "frame";
  const video = a.kind === "asset" && a.mediaType === "video" || a.kind === "capture" && a.record || a.kind === "generate" && a.mediaType === "video" || ["trim", "compose"].includes(a.kind);
  const compatible =
    (b.kind === "write" && text) || (b.kind === "shot" && a.kind === "write" && a.mode === "storyboard") ||
    (b.kind === "generate" && (text || image)) ||
    (["compose", "frame"].includes(b.kind) && video) ||
    (b.kind === "capture" && ["url", "search"].includes(a.kind)) ||
    (b.kind === "trim" && video) ||
    (b.kind === "deliver" && !["url", "search", "deliver"].includes(a.kind));
  if (!compatible)
    return "连线类型不匹配：浏览需要网址，裁剪需要录像，输出需要素材。";
  if (
    graph.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    )
  )
    return "这两个节点已经连接。";
  if (
    !["deliver", "write", "generate", "compose"].includes(b.kind) &&
    graph.edges.some((edge) => edge.target === targetId)
  )
    return "这个节点只能连接一个输入。";
  const visit = [targetId],
    seen = new Set<string>();
  while (visit.length) {
    const id = visit.pop()!;
    if (id === sourceId) return "连线会形成循环，请调整执行顺序。";
    if (seen.has(id)) continue;
    seen.add(id);
    visit.push(
      ...graph.edges
        .filter((edge) => edge.source === id)
        .map((edge) => edge.target),
    );
  }
  return null;
}

export function validateWorkflow(graph: WorkflowGraph): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [],
    nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodes.size !== graph.nodes.length)
    issues.push({ message: "节点标识重复。" });
  const edgeIds = new Set<string>(),
    accepted: WorkflowGraph = { ...graph, edges: [] };
  for (const edge of graph.edges) {
    const error = connectionIssue(accepted, edge.source, edge.target);
    if (error || edgeIds.has(edge.id))
      issues.push({ nodeId: edge.target, message: error ?? "连线标识重复。" });
    else accepted.edges.push(edge);
    edgeIds.add(edge.id);
  }
  const outputs = graph.nodes.filter((node) => node.config.kind === "deliver");
  if (outputs.length !== 1)
    issues.push({ message: "需要且只能有一个输出节点。" });
  for (const node of graph.nodes) {
    const input = graph.edges.filter((edge) => edge.target === node.id);
    if(node.config.kind==="asset"&&(!node.config.assetId||!node.config.elementId))issues.push({nodeId:node.id,message:`${node.title}需要重新选择画布素材。`});
    if (
      ["capture", "trim", "deliver", "shot", "frame", "compose"].includes(node.config.kind) &&
      !input.length
    )
      issues.push({ nodeId: node.id, message: `${node.title}缺少输入连线。` });
    if (node.config.kind === "url") {
      if (
        !z.string().url().safeParse(node.config.url).success ||
        !/^https?:\/\//i.test(node.config.url) ||
        /^https?:\/\/[^/?#]*@/i.test(node.config.url)
      )
        issues.push({
          nodeId: node.id,
          message: "请输入不含账号密码的 HTTP(S) 网址。",
        });
    }
    if (node.config.kind === "search" && !node.config.query.trim())
      issues.push({ nodeId: node.id, message: "请输入搜索主题。" });
    if (node.config.kind === "text" && !node.config.text.trim()) issues.push({ nodeId: node.id, message: "填写故事、剧本或角色资料。" });
    if (node.config.kind === "generate" && (!node.config.model.trim() || (!node.config.prompt.trim() && !input.length))) issues.push({ nodeId: node.id, message: "选择生成模型，并填写提示词或连接创作资料。" });
    if (node.config.kind === "write" && !node.config.instruction.trim() && !input.length) issues.push({ nodeId: node.id, message: "给 AI 编剧填写要求或连接故事资料。" });
    if (node.config.kind === "compose" && input.length < 2) issues.push({ nodeId: node.id, message: "合成至少需要两个视频镜头，按输入顺序拼接。" });
    if (node.config.kind === "trim" && node.config.end <= node.config.start)
      issues.push({
        nodeId: node.id,
        message: "裁剪结束时间必须大于开始时间。",
      });
    if (node.config.kind !== "deliver") {
      const queue = [node.id],
        seen = new Set<string>();
      let connected = false;
      while (queue.length) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (nodes.get(id)?.config.kind === "deliver") {
          connected = true;
          break;
        }
        queue.push(
          ...graph.edges
            .filter((edge) => edge.source === id)
            .map((edge) => edge.target),
        );
      }
      if (!connected)
        issues.push({
          nodeId: node.id,
          message: `${node.title}没有通往输出节点。`,
        });
    }
  }
  if (graph.nodes.filter((node) => node.config.kind !== "url").length > 12)
    issues.push({ message: "单次流程最多12个执行节点。" });
  return issues;
}

export function orderWorkflow(graph: WorkflowGraph): WorkflowNode[] {
  const ordered: WorkflowNode[] = [],
    remaining = [...graph.nodes],
    seen = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex((node) =>
      graph.edges
        .filter((edge) => edge.target === node.id)
        .every((edge) => seen.has(edge.source)),
    );
    if (index === -1) throw new Error("流程存在循环或缺失节点。");
    const node = remaining.splice(index, 1)[0]!;
    ordered.push(node);
    seen.add(node.id);
  }
  return ordered;
}

export function compileWorkflow(raw: WorkflowGraph): GoalExecutionPlan {
  const graph = workflowGraphSchema.parse(raw),
    issues = validateWorkflow(graph);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join("\n"));
  const steps: GoalExecutionStep[] = [];
  for (const node of orderWorkflow(graph)) {
    const inputs = graph.edges
      .filter((edge) => edge.target === node.id)
      .map(
        (edge) =>
          graph.nodes.find((candidate) => candidate.id === edge.source)!,
      );
    const config = node.config;
    if (config.kind === "url") continue;
    const base = {
      id: node.id,
      title: node.title,
      dependsOn: inputs
        .filter((node) => node.config.kind !== "url")
        .map((node) => node.id),
      completion: `完成${node.title}并保留可核验结果`,
    };
    if (config.kind === "search")
      steps.push({
        ...base,
        command: { executor: "web.search", query: config.query.trim() },
      });
    if (config.kind === "asset")
      steps.push({ ...base, command: { executor: "canvas.asset", elementId: config.elementId, assetId: config.assetId, mediaType: config.mediaType } });
    if (config.kind === "text") steps.push({ ...base, command: { executor: "content.text", role: config.role, text: config.text } });
    if (config.kind === "write") steps.push({ ...base, command: { executor: "ai.write", sources: inputs.map(input => input.id), mode: config.mode, instruction: config.instruction, shotCount: config.shotCount } });
    if (config.kind === "shot") steps.push({ ...base, command: { executor: "content.shot", fromStep: inputs[0]!.id, index: config.index } });
    if (config.kind === "generate") { const { kind: _kind, ...parameters } = config; steps.push({ ...base, command: { executor: "media.generate", sources: inputs.map(input => input.id), ...parameters } }); }
    if (config.kind === "compose") steps.push({ ...base, command: { executor: "media.compose", sources: inputs.map(input => input.id), aspect: config.aspect } });
    if (config.kind === "frame") steps.push({ ...base, command: { executor: "media.frame", fromStep: inputs[0]!.id, at: config.at } });
    if (config.kind === "capture") {
      const input = inputs[0]!;
      steps.push({
        ...base,
        command: {
          executor: "web.capture",
          pageLimit: config.pageLimit,
          record: config.record,
          ...(input.config.kind === "url"
            ? { url: input.config.url }
            : { fromStep: input.id }),
        },
      });
    }
    if (config.kind === "trim")
      steps.push({
        ...base,
        command: {
          executor: "media.trim",
          fromStep: inputs[0]!.id,
          start: config.start,
          end: config.end,
          aspect: config.aspect,
        },
      });
    if (config.kind === "deliver")
      steps.push({
        ...base,
        command: {
          executor: "result.deliver",
          sources: inputs.map((input) => input.id),
        },
      });
  }
  return goalExecutionPlanSchema.parse({ summary: graph.title, steps });
}

export function layoutWorkflow(graph: WorkflowGraph): WorkflowGraph {
  const depth = new Map<string, number>(),
    rows = new Map<number, number>();
  const nodes = orderWorkflow(graph).map((node) => {
    const level = Math.max(
      0,
      ...graph.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => (depth.get(edge.source) ?? 0) + 1),
    );
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    depth.set(node.id, level);
    return { ...node, position: { x: level * 390, y: row * 260 } };
  });
  return { ...graph, nodes };
}

export function workflowFromPlan(plan: GoalExecutionPlan): WorkflowGraph {
  const nodes: WorkflowNode[] = [],
    edges: WorkflowGraph["edges"] = [];
  const connect = (source: string, target: string) =>
    edges.push({ id: `e-${edges.length}`, source, target });
  for (const step of plan.steps) {
    const c = step.command,
      base = {
        id: step.id,
        title: step.title.slice(0, 100),
        position: { x: 0, y: 0 },
      };
    if (c.executor === "desktop.actions")
      throw new Error(
        "当前可视化工作流暂不支持桌面操作节点，请在 Agent 工作区执行。",
      );
    if (c.executor === "web.search")
      nodes.push({ ...base, config: { kind: "search", query: c.query } });
    if (c.executor === "canvas.asset")
      nodes.push({ ...base, config: { kind: "asset", elementId: c.elementId, assetId: c.assetId, mediaType: c.mediaType } });
    if (c.executor === "content.text") nodes.push({ ...base, config: { kind: "text", role: c.role, text: c.text } });
    if (c.executor === "ai.write") { nodes.push({ ...base, config: { kind: "write", mode: c.mode, instruction: c.instruction, shotCount: c.shotCount } }); c.sources.forEach(id => connect(id, step.id)); }
    if (c.executor === "content.shot") { nodes.push({ ...base, config: { kind: "shot", index: c.index } }); connect(c.fromStep, step.id); }
    if (c.executor === "media.generate") { const { executor: _executor, sources, ...parameters } = c; nodes.push({ ...base, config: { kind: "generate", ...parameters } }); sources.forEach(id => connect(id, step.id)); }
    if (c.executor === "media.compose") { nodes.push({ ...base, config: { kind: "compose", aspect: c.aspect } }); c.sources.forEach(id => connect(id, step.id)); }
    if (c.executor === "media.frame") { nodes.push({ ...base, config: { kind: "frame", at: c.at } }); connect(c.fromStep, step.id); }
    if (c.executor === "web.capture") {
      if (c.url) {
        let inputId = `url-${nodes.length}`;
        while (plan.steps.some((step) => step.id === inputId)) inputId += "-a";
        nodes.push({
          id: inputId,
          title: "目标网址",
          position: { x: 0, y: 0 },
          config: { kind: "url", url: c.url },
        });
        connect(inputId, step.id);
      } else connect(c.fromStep!, step.id);
      nodes.push({
        ...base,
        config: { kind: "capture", record: c.record, pageLimit: c.pageLimit },
      });
    }
    if (c.executor === "media.trim") {
      nodes.push({
        ...base,
        config: { kind: "trim", start: c.start, end: c.end, aspect: c.aspect },
      });
      connect(c.fromStep, step.id);
    }
    if (c.executor === "result.deliver") {
      nodes.push({ ...base, config: { kind: "deliver" } });
      c.sources.forEach((id) => connect(id, step.id));
    }
  }
  const graph = layoutWorkflow({
    title: plan.summary.slice(0, 120),
    nodes,
    edges,
  });
  compileWorkflow(graph);
  return graph;
}

export function websiteWorkflow(record = false): WorkflowGraph {
  return {
    title: record ? "网站录制与交付" : "网站研究与截图",
    nodes: [
      {
        id: "site",
        title: "目标网址",
        position: { x: 0, y: 0 },
        config: { kind: "url", url: "" },
      },
      {
        id: "capture",
        title: record ? "录制网站" : "读取网页与截图",
        position: { x: 390, y: 0 },
        config: { kind: "capture", record, pageLimit: 1 },
      },
      {
        id: "deliver",
        title: "保存到画布与聊天",
        position: { x: 780, y: 0 },
        config: { kind: "deliver" },
      },
    ],
    edges: [
      { id: "e-1", source: "site", target: "capture" },
      { id: "e-2", source: "capture", target: "deliver" },
    ],
  };
}
