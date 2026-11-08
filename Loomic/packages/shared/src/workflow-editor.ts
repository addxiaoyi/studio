import {
  connectionIssue,
  workflowGraphSchema,
  workflowNodeSchema,
  type WorkflowGraph,
  type WorkflowNode,
} from "./canvas-workflow.js";

/** Preserve the target edge's position: composed media uses ordered inputs. */
export function insertWorkflowNode(
  raw: WorkflowGraph,
  edgeId: string,
  candidate: WorkflowNode,
  inputEdgeId: string,
): WorkflowGraph {
  const graph = workflowGraphSchema.parse(raw),
    node = workflowNodeSchema.parse(candidate);
  const edge = graph.edges.find((edge) => edge.id === edgeId);
  if (!edge) throw new Error("连线已改变，请重新选择。");
  if (graph.nodes.some((item) => item.id === node.id))
    throw new Error("节点标识重复。");
  if (graph.edges.some((item) => item.id === inputEdgeId))
    throw new Error("连线标识重复。");
  const next: WorkflowGraph = {
    ...graph,
    nodes: [...graph.nodes, node],
    edges: graph.edges.filter((item) => item.id !== edgeId),
  };
  const inputIssue = connectionIssue(next, edge.source, node.id);
  if (inputIssue) throw new Error(inputIssue);
  next.edges.push({ id: inputEdgeId, source: edge.source, target: node.id });
  const outputIssue = connectionIssue(next, node.id, edge.target);
  if (outputIssue) throw new Error(outputIssue);
  next.edges = graph.edges.flatMap((item) =>
    item.id === edgeId
      ? [
          { id: inputEdgeId, source: edge.source, target: node.id },
          { ...item, source: node.id },
        ]
      : [item],
  );
  return workflowGraphSchema.parse(next);
}

/** A partial run uses fresh upstream work and its own delivery; it never rewrites the saved graph. */
export function workflowRunGraph(
  raw: WorkflowGraph,
  targetId?: string,
): WorkflowGraph {
  const graph = workflowGraphSchema.parse(raw);
  if (!targetId) return graph;
  const target = graph.nodes.find((node) => node.id === targetId);
  if (!target) throw new Error("目标节点不存在。");
  if (["url", "search"].includes(target.config.kind))
    throw new Error("请在使用该网址的下游处理节点执行。");
  const needed = new Set<string>(),
    queue = [target.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);
    queue.push(
      ...graph.edges
        .filter((edge) => edge.target === id)
        .map((edge) => edge.source),
    );
  }
  const scoped: WorkflowGraph = {
    title: graph.title,
    nodes: graph.nodes.filter((node) => needed.has(node.id)),
    edges: graph.edges.filter(
      (edge) => needed.has(edge.source) && needed.has(edge.target),
    ),
  };
  if (target.config.kind === "deliver") return scoped;
  let id = "preview-output";
  while (graph.nodes.some((node) => node.id === id)) id += "-x";
  let edgeId = "preview-delivery";
  while (graph.edges.some((edge) => edge.id === edgeId)) edgeId += "-x";
  scoped.nodes.push({
    id,
    title: "保存本次节点结果",
    position: {
      x: Math.min(990600, target.position.x + 390),
      y: target.position.y,
    },
    config: { kind: "deliver" },
  });
  scoped.edges.push({ id: edgeId, source: target.id, target: id });
  return workflowGraphSchema.parse(scoped);
}
