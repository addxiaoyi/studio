import type { WorkflowGraph } from "@helstera/shared";
import type { SceneElement } from "./scene";
export const workflowGroupId = (workflowId: string, id: string) =>
  `wfg:${workflowId}:${id}`;
export function collapsedGroup(graph: WorkflowGraph, nodeId: string) {
  return graph.groups?.find(
    (group) => group.collapsed && group.nodeIds.includes(nodeId),
  );
}
export function workflowGroupBounds(
  graph: WorkflowGraph,
  nodeIds: string[],
  scene: readonly SceneElement[],
) {
  const nodes = graph.nodes.filter((node) => nodeIds.includes(node.id));
  const bounds = nodes.map((node) => {
    const element = scene.find(
      (el) =>
        (el.customData?.workflow as { node?: { id?: string } } | undefined)
          ?.node?.id === node.id,
    );
    return {
      x: node.position.x,
      y: node.position.y,
      width: element?.width ?? 300,
      height: element?.height ?? (node.config.kind === "generate" ? 280 : 184),
    };
  });
  const x = Math.min(...bounds.map((box) => box.x)) - 24,
    y = Math.min(...bounds.map((box) => box.y)) - 48;
  return {
    x,
    y,
    width: Math.max(...bounds.map((box) => box.x + box.width)) - x + 24,
    height: Math.max(...bounds.map((box) => box.y + box.height)) - y + 24,
  };
}
export function groupMovement(
  scene: readonly SceneElement[],
  workflowId: string,
  graph: WorkflowGraph,
) {
  const moved = new Map<string, { x: number; y: number }>();
  const groups = graph.groups?.filter((group) => {
    const el = scene.find(
      (item) => item.id === workflowGroupId(workflowId, group.id),
    );
    if (el?.isDeleted) return false;
    const anchor = (
      el?.customData?.workflowGroup as
        | { anchor?: { x: number; y: number } }
        | undefined
    )?.anchor;
    if (el && anchor && (el.x !== anchor.x || el.y !== anchor.y))
      for (const id of group.nodeIds)
        moved.set(id, { x: el.x - anchor.x, y: el.y - anchor.y });
    return true;
  });
  return { groups, moved };
}
