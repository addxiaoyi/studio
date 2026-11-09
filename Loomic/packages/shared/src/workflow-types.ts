import type { WorkflowGraph } from "./canvas-workflow.js";
export type WorkflowValueKind = "text" | "image" | "video" | "json" | "url" | "list";
export function workflowValueKinds(
  graph: WorkflowGraph,
  id: string,
  seen = new Set<string>(),
): Set<WorkflowValueKind> {
  if (seen.has(id)) return new Set();
  seen.add(id);
  const c = graph.nodes.find((node) => node.id === id)?.config;
  if (!c) return new Set();
  if (c.kind === "condition" || c.kind === "switch" || c.kind === "delay")
    return new Set(
      graph.edges
        .filter((edge) => edge.target === id)
        .flatMap((edge) => [
          ...workflowValueKinds(graph, edge.source, new Set(seen)),
        ]),
    );
  if (
    [
      "text",
      "write",
      "shot",
      "transform",
      "template",
      "merge",
      "extract",
    ].includes(c.kind)
  )
    return new Set(["text"]);
  if (c.kind === "json") return new Set(["json"]);
  if (c.kind === "split" || c.kind === "batch") return new Set(["list", "json", "text"]);
  if (c.kind === "url" || c.kind === "search") return new Set(["url"]);
  if (c.kind === "asset" || c.kind === "generate")
    return new Set([c.mediaType]);
  if (c.kind === "capture")
    return new Set(c.record ? ["image", "video", "text"] : ["image", "text"]);
  if (c.kind === "frame") return new Set(["image"]);
  if (c.kind === "trim" || c.kind === "compose") return new Set(["video"]);
  return new Set();
}
export function prunePinnedAncestors(graph: WorkflowGraph): WorkflowGraph {
  if (!graph.nodes.some((node) => node.pin)) return graph;
  for (const node of graph.nodes.filter((node) => node.pin)) {
    const seen = new Set<string>(),
      queue = graph.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => edge.source);
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (
        ["condition", "switch"].includes(graph.nodes.find((item) => item.id === id)?.config.kind ?? "")
      )
        throw new Error(
          "条件分支内的节点不能固定，请固定分支之前的来源，保留分支判断。",
        );
      queue.push(
        ...graph.edges
          .filter((edge) => edge.target === id)
          .map((edge) => edge.source),
      );
    }
  }
  const visit = (stop: boolean) => {
    const reached = new Set<string>(),
      queue = graph.nodes
        .filter((node) => node.config.kind === "deliver")
        .map((node) => node.id);
    while (queue.length) {
      const id = queue.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      if (stop && graph.nodes.find((node) => node.id === id)?.pin) continue;
      queue.push(
        ...graph.edges
          .filter((edge) => edge.target === id)
          .map((edge) => edge.source),
      );
    }
    return reached;
  };
  const original = visit(false),
    needed = visit(true),
    nodes = graph.nodes.filter(
      (node) => !original.has(node.id) || needed.has(node.id),
    ),
    ids = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(
      (edge) =>
        ids.has(edge.source) &&
        ids.has(edge.target) &&
        !nodes.find((node) => node.id === edge.target)?.pin,
    ),
    ...(graph.groups
      ? {
          groups: graph.groups
            .map((group) => ({
              ...group,
              nodeIds: group.nodeIds.filter((id) => ids.has(id)),
            }))
            .filter((group) => group.nodeIds.length),
        }
      : {}),
  };
}
