import { z } from "zod";
import { workflowGraphSchema, type WorkflowGraph } from "./canvas-workflow.js";

export const libraryBodySchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("workflow"), graph: workflowGraphSchema })
    .strict(),
  z
    .object({
      kind: z.literal("prompt"),
      prompt: z.string().trim().min(1).max(4000),
    })
    .strict(),
]);
export const creativeLibraryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  body: libraryBodySchema,
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type CreativeLibraryBody = z.infer<typeof libraryBodySchema>;
export type CreativeLibraryEntry = z.infer<typeof creativeLibraryEntrySchema>;

/** A library recipe contains parameters, never a live permission to another canvas's media. */
export function portableWorkflow(
  input: WorkflowGraph,
  selectedIds?: string[],
): WorkflowGraph {
  const graph = workflowGraphSchema.parse(input);
  const selected = selectedIds?.length
    ? new Set(selectedIds)
    : new Set(graph.nodes.map((node) => node.id));
  const nodes = graph.nodes.filter((node) => selected.has(node.id));
  if (!nodes.length) throw new Error("请选择要保存的流程节点。");
  const x = Math.min(...nodes.map((node) => node.position.x)),
    y = Math.min(...nodes.map((node) => node.position.y));
  return {
    ...graph,
    ...(graph.groups?{groups:graph.groups.map(group=>({...group,nodeIds:group.nodeIds.filter(id=>selected.has(id))})).filter(group=>group.nodeIds.length)}:{}),
    nodes: nodes.map((node) => ({
      ...Object.fromEntries(Object.entries(node).filter(([key])=>key!=="pin")) as typeof node,
      position: { x: node.position.x - x, y: node.position.y - y },
      config:
        node.config.kind === "asset"
          ? { ...node.config, assetId: "", elementId: "" }
          : node.config,
    })),
    edges: graph.edges.filter(
      (edge) => selected.has(edge.source) && selected.has(edge.target),
    ),
  };
}
export function instantiateWorkflow(
  input: WorkflowGraph,
  instanceId: string,
): WorkflowGraph {
  const graph = portableWorkflow(input),
    prefix = instanceId
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 24);
  if (!prefix) throw new Error("模板实例标识无效。");
  const ids = new Map(
    graph.nodes.map((node, index) => [node.id, `n-${prefix}-${index}`]),
  );
  return {
    ...graph,
    ...(graph.groups?{groups:graph.groups.map((group,index)=>({...group,id:`g-${prefix}-${index}`,nodeIds:group.nodeIds.map(id=>ids.get(id)!)}))}:{}),
    nodes: graph.nodes.map((node) => ({
      ...node,
      id: ids.get(node.id)!,
      config: { ...node.config },
    })),
    edges: graph.edges.map((edge, index) => ({
      ...edge,
      id: `e-${prefix}-${index}`,
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
    })),
  };
}
export const CREATIVE_PROMPTS = [
  {
    id: "cinematic",
    name: "电影感自然光",
    description: "统一镜头光线、景深和材质",
    prompt:
      "使用柔和自然光、真实材质和有层次的景深。明确主体、景别与背景关系，保留高光和暗部细节；镜头运动平稳，避免夸张变形和不必要的闪烁。",
  },
  {
    id: "product",
    name: "商品展示",
    description: "突出商品外观与卖点",
    prompt:
      "以商品为唯一视觉主角，保留原有造型、颜色、包装文字和比例。采用干净背景与柔和棚拍光，展示整体、细节和使用场景；不添加不存在的功能、认证或宣传文字。",
  },
  {
    id: "character",
    name: "角色一致性",
    description: "用于多个分镜的共同约束",
    prompt:
      "各镜头保持同一角色的面部、发型、服装、体型和关键配饰一致。参考素材优先于风格描述，动作与场景可以变化；不要增加角色、替换服装或改变身份特征。",
  },
  {
    id: "storyboard",
    name: "可拍摄分镜",
    description: "把文字变成清楚的镜头要求",
    prompt:
      "按故事的因果顺序组织镜头，每镜头只表达一个主要动作。写清主体、环境、景别、机位、运镜、对白和时长；镜头间保持空间方向与角色动作连续，避免无法拍摄的抽象描述。",
  },
  {
    id: "vertical",
    name: "竖屏短片",
    description: "适合手机观看的构图与节奏",
    prompt:
      "采用竖屏构图，主体和关键动作位于中央安全区。开头尽快交代主题，镜头简洁、节奏清楚；避免把人物面部、商品标识或关键信息放在屏幕边缘，不擅自添加字幕与水印。",
  },
] as const;
