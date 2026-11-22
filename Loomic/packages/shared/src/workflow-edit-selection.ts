import {
  type WorkflowGraph,
  connectionIssue,
  workflowGraphSchema,
} from "./canvas-workflow.js";

export type WorkflowEdit = {
  id: string;
  kind:
    | "node-add"
    | "node-remove"
    | "node-change"
    | "edge-add"
    | "edge-remove"
    | "edge-change"
    | "edge-order"
    | "graph-change";
  title: string;
  detail: string;
  destructive: boolean;
  requires: string[];
};
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function workflowEdits(
  before: WorkflowGraph | null,
  raw: WorkflowGraph,
): WorkflowEdit[] {
  const after = workflowGraphSchema.parse(raw);
  if (
    new Set(after.nodes.map((node) => node.id)).size !== after.nodes.length ||
    new Set(after.edges.map((edge) => edge.id)).size !== after.edges.length
  ) {
    throw new Error("AI 方案包含重复的节点或连线标识，请重新生成。");
  }
  const base = before ? workflowGraphSchema.parse(before) : null;
  if (
    base &&
    (new Set(base.nodes.map((node) => node.id)).size !== base.nodes.length ||
      new Set(base.edges.map((edge) => edge.id)).size !== base.edges.length)
  ) {
    throw new Error("当前流程包含重复的节点或连线标识，请先修复或另存流程。");
  }
  const edits: WorkflowEdit[] = [];
  for (const node of after.nodes) {
    const prior = base?.nodes.find((item) => item.id === node.id);
    if (!prior || !same(prior, node))
      edits.push({
        id: `${prior ? "node-change" : "node-add"}:${node.id}`,
        kind: prior ? "node-change" : "node-add",
        title: node.title,
        detail: prior ? "更新此节点的参数、名称或位置" : "新增此节点及所需连线",
        destructive: false,
        requires: [],
      });
  }
  for (const node of base?.nodes ?? []) {
    if (after.nodes.some((item) => item.id === node.id)) continue;
    const connected =
      base?.edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id,
      ).length ?? 0;
    edits.push({
      id: `node-remove:${node.id}`,
      kind: "node-remove",
      title: node.title,
      detail: `删除节点，并移除或改接 ${connected} 条相关连线`,
      destructive: true,
      requires: [],
    });
  }
  for (const edge of after.edges) {
    const prior = base?.edges.find((item) => item.id === edge.id);
    if (prior && same(prior, edge)) continue;
    edits.push({
      id: `${prior ? "edge-change" : "edge-add"}:${edge.id}`,
      kind: prior ? "edge-change" : "edge-add",
      title: `${after.nodes.find((node) => node.id === edge.source)?.title ?? edge.source} → ${after.nodes.find((node) => node.id === edge.target)?.title ?? edge.target}`,
      detail: prior ? "更新连线端点或分支出口" : "新增连线",
      destructive: false,
      requires: [],
    });
  }
  for (const edge of base?.edges ?? [])
    if (!after.edges.some((item) => item.id === edge.id)) {
      edits.push({
        id: `edge-remove:${edge.id}`,
        kind: "edge-remove",
        title: `${edge.source} → ${edge.target}`,
        detail: "断开连线",
        destructive: false,
        requires: [],
      });
    }
  if (
    !same(
      base?.edges.map((edge) => edge.id) ?? [],
      after.edges.map((edge) => edge.id),
    )
  ) {
    edits.push({
      id: "edge-order",
      kind: "edge-order",
      title: "连线顺序",
      detail: "按提议排序，影响合成等节点的输入顺序",
      destructive: false,
      requires: [],
    });
  }
  const commonIds = new Set(
    after.nodes
      .filter((node) => base?.nodes.some((prior) => prior.id === node.id))
      .map((node) => node.id),
  );
  const nodeOrderChanged = !same(
    base?.nodes
      .filter((node) => commonIds.has(node.id))
      .map((node) => node.id) ?? [],
    after.nodes.filter((node) => commonIds.has(node.id)).map((node) => node.id),
  );
  if (
    !base ||
    base.title !== after.title ||
    !same(base.groups ?? [], after.groups ?? []) ||
    nodeOrderChanged
  ) {
    edits.push({
      id: "graph-change",
      kind: "graph-change",
      title: "流程名称与分组",
      detail: "更新名称、分组、节点顺序及折叠状态",
      destructive: false,
      requires: [],
    });
  }
  for (const edit of edits) {
    if (edit.kind === "node-add") {
      const id = edit.id.slice("node-add:".length);
      edit.requires = after.edges
        .filter((edge) => edge.source === id || edge.target === id)
        .flatMap((edge) =>
          edits
            .filter(
              (item) =>
                item.id === `edge-add:${edge.id}` ||
                item.id === `edge-change:${edge.id}`,
            )
            .map((item) => item.id),
        );
    }
    if (edit.kind === "node-remove") {
      const id = edit.id.slice("node-remove:".length);
      edit.requires = (base?.edges ?? [])
        .filter((edge) => edge.source === id || edge.target === id)
        .flatMap((edge) =>
          edits
            .filter(
              (item) =>
                item.id === `edge-remove:${edge.id}` ||
                item.id === `edge-change:${edge.id}`,
            )
            .map((item) => item.id),
        );
    }
    if (edit.kind === "edge-add" || edit.kind === "edge-change") {
      const edge = after.edges.find(
        (item) => edit.id === `${edit.kind}:${item.id}`,
      );
      edit.requires = edits
        .filter(
          (item) =>
            item.kind === "node-add" &&
            (item.id === `node-add:${edge?.source}` ||
              item.id === `node-add:${edge?.target}`),
        )
        .map((item) => item.id);
      if (edits.some((item) => item.id === "edge-order"))
        edit.requires.push("edge-order");
    }
  }
  return edits;
}

export function resolveWorkflowEdits(
  edits: WorkflowEdit[],
  requested: string[],
): string[] {
  const lookup = new Map(edits.map((edit) => [edit.id, edit]));
  const chosen = new Set<string>();
  const queue = [...requested];
  while (queue.length) {
    const id = queue.pop();
    if (!id || chosen.has(id)) continue;
    const edit = lookup.get(id);
    if (!edit) throw new Error("选择的改动不存在，请重新检查 AI 方案。");
    chosen.add(id);
    queue.push(...edit.requires);
  }
  return [...chosen].sort();
}

export function toggleWorkflowEdit(
  edits: WorkflowEdit[],
  requested: string[],
  id: string,
  checked: boolean,
): string[] {
  if (checked) return [...new Set([...requested, id])];
  const removed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edit of edits)
      if (
        !removed.has(edit.id) &&
        edit.requires.some((required) => removed.has(required))
      ) {
        removed.add(edit.id);
        grew = true;
      }
  }
  return requested.filter((item) => !removed.has(item));
}

export function selectWorkflowEdits(
  before: WorkflowGraph | null,
  raw: WorkflowGraph,
  requested?: string[],
) {
  const after = workflowGraphSchema.parse(raw);
  const base: WorkflowGraph = before
    ? workflowGraphSchema.parse(before)
    : { title: after.title, nodes: [], edges: [] };
  const edits = workflowEdits(before, after);
  const selectedChanges = resolveWorkflowEdits(
    edits,
    requested ?? edits.map((edit) => edit.id),
  );
  const chosen = new Set(selectedChanges);
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  for (const node of after.nodes)
    if (
      chosen.has(`node-add:${node.id}`) ||
      chosen.has(`node-change:${node.id}`)
    )
      nodes.set(node.id, node);
  for (const node of base.nodes)
    if (chosen.has(`node-remove:${node.id}`)) nodes.delete(node.id);
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]));
  for (const edge of after.edges)
    if (
      chosen.has(`edge-add:${edge.id}`) ||
      chosen.has(`edge-change:${edge.id}`)
    )
      edges.set(edge.id, edge);
  for (const edge of base.edges)
    if (chosen.has(`edge-remove:${edge.id}`)) edges.delete(edge.id);
  for (const [id, edge] of edges)
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) edges.delete(id);
  const edgeOrder = new Map(after.edges.map((edge, index) => [edge.id, index]));
  const orderedEdges = chosen.has("edge-order")
    ? [...edges.values()].sort(
        (left, right) =>
          (edgeOrder.get(left.id) ?? after.edges.length) -
          (edgeOrder.get(right.id) ?? after.edges.length),
      )
    : [...edges.values()];
  let orderedNodes = base.nodes.flatMap((node) =>
    nodes.has(node.id) ? [nodes.get(node.id) ?? node] : [],
  );
  for (const [index, node] of after.nodes.entries()) {
    if (!nodes.has(node.id) || orderedNodes.some((item) => item.id === node.id))
      continue;
    const following = after.nodes
      .slice(index + 1)
      .find((item) => orderedNodes.some((prior) => prior.id === item.id));
    const position = following
      ? orderedNodes.findIndex((item) => item.id === following.id)
      : orderedNodes.length;
    orderedNodes.splice(position, 0, nodes.get(node.id) ?? node);
  }
  if (chosen.has("graph-change")) {
    const common = after.nodes.filter(
      (node) =>
        nodes.has(node.id) && base.nodes.some((prior) => prior.id === node.id),
    );
    let cursor = 0;
    orderedNodes = orderedNodes.map((node) =>
      common.some((item) => item.id === node.id)
        ? (nodes.get(common[cursor++]?.id ?? "") ?? node)
        : node,
    );
  }
  const groups = (chosen.has("graph-change") ? after.groups : base.groups)
    ?.map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => nodes.has(id)),
    }))
    .filter((group) => group.nodeIds.length);
  const graph = workflowGraphSchema.parse({
    title: chosen.has("graph-change") ? after.title : base.title,
    nodes: orderedNodes,
    edges: orderedEdges,
    ...(groups ? { groups } : {}),
  });
  const connected: WorkflowGraph = { ...graph, edges: [] };
  for (const edge of graph.edges) {
    const issue = connectionIssue(
      connected,
      edge.source,
      edge.target,
      edge.branch,
    );
    if (issue)
      throw new Error(
        `所选改动的连线不完整：${issue} 请同时选择相关节点或连线修改。`,
      );
    connected.edges.push(edge);
  }
  return {
    graph,
    selectedChanges,
    edits,
    destructive: edits.filter(
      (edit) => chosen.has(edit.id) && edit.destructive,
    ),
  };
}
