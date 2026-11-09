import { connectionIssue, type WorkflowGraph } from "@helstera/shared";
import { materialNode, workflowBinding, type SceneElement } from "./scene";
import { workflowInputReferences } from "./material-references";
export { workflowInputReferences } from "./material-references";

const MAX_REFERENCES = 6;
export function embedWorkflowMaterials(
  graph: WorkflowGraph,
  elements: readonly SceneElement[],
  targetId: string,
): WorkflowGraph {
  const target = graph.nodes.find((node) => node.id === targetId);
  if (!target) throw new Error("目标节点已删除，请重新选择。");
  if (!elements.length) throw new Error("先在画布中选择图片或视频。");
  const next: WorkflowGraph = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
  };
  const connect = (source: string, destination: string) => {
    if (
      next.edges.some(
        (edge) => edge.source === source && edge.target === destination,
      )
    )
      return;
    const issue = connectionIssue(next, source, destination);
    if (issue) throw new Error(issue);
    next.edges.push({
      id: `edge-${crypto.randomUUID()}`,
      source,
      target: destination,
    });
  };
  for (const element of elements) {
    const material = materialNode(element);
    if (!material)
      throw new Error("素材尚未上传完成或已经删除，请先保存画布再嵌入。");
    let source = next.nodes.find(
      (node) =>
        node.config.kind === "asset" && node.config.elementId === element.id,
    );
    if (!source && workflowBinding(element))
      throw new Error("素材已关联其他流程，请先解除原流程中的素材输入绑定；原素材会保留在画布。");
    if (!source) {
      source = material;
      next.nodes.push(source);
    }
    if (
      source.config.kind === "asset" &&
      source.config.mediaType === "video" &&
      target.config.kind === "generate"
    ) {
      let frame = next.nodes.find(
        (node) =>
          node.config.kind === "frame" &&
          next.edges.some(
            (edge) => edge.source === source!.id && edge.target === node.id,
          ) &&
          next.edges.some(
            (edge) => edge.source === node.id && edge.target === target.id,
          ),
      );
      if (!frame) {
        frame = {
          id: `ref-frame-${crypto.randomUUID()}`,
          title: `${source.title.slice(0, 75)} · 参考帧`,
          position: { x: target.position.x - 370, y: target.position.y + 320 },
          config: { kind: "frame", at: 0 },
        };
        next.nodes.push(frame);
        connect(source.id, frame.id);
      }
      connect(frame.id, target.id);
    } else connect(source.id, target.id);
  }
  if (
    next.nodes.length > 64 ||
    next.edges.length > 128
  )
    throw new Error("流程节点已满，单次最多64个执行节点。请拆分流程后再添加。");
  if (next.edges.filter((edge) => edge.target === targetId).length > 8)
    throw new Error("这个节点最多接入8项资料。");
  if (
    target.config.kind === "generate" &&
    workflowInputReferences(next, targetId).length > MAX_REFERENCES
  )
    throw new Error("每个生成节点最多6张参考图，视频抽帧也占一张。");
  return next;
}

export function removeWorkflowReference(
  graph: WorkflowGraph,
  targetId: string,
  sourceId: string,
): WorkflowGraph {
  let edges = graph.edges.filter(
    (edge) => edge.target !== targetId || edge.source !== sourceId,
  );
  let nodes = [...graph.nodes];
  const prune = (id: string) => {
    if (edges.some((edge) => edge.source === id)) return;
    const node = nodes.find((item) => item.id === id);
    if (
      !node ||
      (node.config.kind !== "asset" && !node.id.startsWith("ref-frame-"))
    )
      return;
    const parents = edges
      .filter((edge) => edge.target === id)
      .map((edge) => edge.source);
    nodes = nodes.filter((item) => item.id !== id);
    edges = edges.filter((edge) => edge.target !== id);
    parents.forEach(prune);
  };
  prune(sourceId);
  return { ...graph, nodes, edges };
}
