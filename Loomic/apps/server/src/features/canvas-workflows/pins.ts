import type { Pool, PoolClient } from "pg";
import type { WorkflowGraph, WorkflowNode } from "@helstera/shared";
import { fingerprintPayload } from "../generation/generation-approval-service.js";
type Db = Pick<Pool | PoolClient, "query">;
type Scope = { workflowId: string; workspaceId: string; userId: string };

export async function readPinnedOutput(
  db: Db,
  node: WorkflowNode,
  scope: Scope,
): Promise<Record<string, unknown>> {
  if (!node.pin) throw new Error("节点没有固定结果。");
  if (
    ["url", "search", "condition", "delay", "deliver"].includes(node.config.kind) ||
    node.pin.nodeId !== node.id
  )
    throw new Error("该节点不能使用这项固定结果。");
  const row = (
    await db.query<{ output: Record<string, unknown>; graph: WorkflowGraph }>(
      `select s.output,r.graph from canvas_workflow_runs r
    join canvas_workflows w on w.id=r.workflow_id join agent_goal_steps s on s.goal_id=r.goal_id
    where r.workflow_id=$1 and r.goal_id=$2 and s.step_id=$3 and s.state='succeeded'
      and w.created_by=$4 and w.workspace_id=$5`,
      [
        scope.workflowId,
        node.pin.goalId,
        node.pin.nodeId,
        scope.userId,
        scope.workspaceId,
      ],
    )
  ).rows[0];
  const original = row?.graph.nodes.find(
    (item) => item.id === node.pin!.nodeId,
  );
  if (!row?.output || row.output.skipped === true || !original)
    throw new Error("固定结果不存在、尚未成功或无权访问。");
  if (fingerprintPayload(original.config) !== fingerprintPayload(node.config))
    throw new Error(`“${node.title}”参数已改变，请取消固定或重新执行。`);
  const ids = new Set<string>();
  for (const item of Array.isArray(row.output.assets)
    ? row.output.assets
    : []) {
    if (item && typeof item === "object" && typeof item.id === "string")
      ids.add(item.id);
  }
  for (const item of Array.isArray(row.output.pages) ? row.output.pages : []) {
    if (item && typeof item === "object" && typeof item.assetId === "string")
      ids.add(item.assetId);
  }
  if (typeof row.output.recordingAssetId === "string")
    ids.add(row.output.recordingAssetId);
  if (ids.size > 32) throw new Error("固定结果包含过多素材。");
  for (const id of ids) {
    if (!/^[a-f\d-]{36}$/i.test(id))
      throw new Error("固定结果的素材标识无效。");
    const asset = (
      await db.query(
        `select ao.id from asset_objects ao left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
      where (ao.id=$1 or ga.id=$1) and ao.workspace_id=$2 and ao.created_by=$3
      and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))`,
        [id, scope.workspaceId, scope.userId],
      )
    ).rows[0];
    if (!asset)
      throw new Error(
        `“${node.title}”的固定素材已到期、删除或被撤销，请取消固定。`,
      );
  }
  return {
    ...row.output,
    pinned: true,
    pinnedFrom: { goalId: node.pin.goalId, nodeId: node.pin.nodeId },
  };
}
export async function assertWorkflowPins(
  db: Db,
  graph: WorkflowGraph,
  scope: Scope,
) {
  for (const node of graph.nodes)
    if (node.pin) await readPinnedOutput(db, node, scope);
}
