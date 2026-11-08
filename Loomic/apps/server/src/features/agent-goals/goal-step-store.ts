import { fingerprintPayload } from "../generation/generation-approval-service.js";
import type { Pool, PoolClient } from "pg";
import type { GoalCommand, AgentGoalPlan } from "@helstera/shared";

export type GoalStepRow = { id: string; goal_id: string; step_id: string; title: string; executor: GoalCommand["executor"]; command: GoalCommand; depends_on: string[]; state: string; attempt: number; fingerprint: string; approval: string; approval_expires_at: Date | null; lease_token: string | null; output: Record<string, unknown> | null; error: string | null };
export const goalStepFingerprint = (goalId: string, stepId: string, command: GoalCommand) => fingerprintPayload({ goalId, stepId, command, credits: 0 });
export const requiresStepApproval = (command: GoalCommand) => command.executor === "web.capture" && command.record || ["media.trim", "media.compose", "media.frame"].includes(command.executor);

export async function initializeGoalSteps(db: Pick<Pool, "query">, goalId: string, plan: AgentGoalPlan) {
  for (const [ordinal, step] of plan.steps.entries()) {
    if (!step.command) throw new Error("执行计划缺少动作参数。");
    const approval = requiresStepApproval(step.command) ? "pending" : "not_required";
    await db.query(`insert into agent_goal_steps(goal_id,step_id,ordinal,title,executor,command,depends_on,completion,fingerprint,approval)
      values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10) on conflict(goal_id,step_id) do nothing`, [goalId, step.id, ordinal, step.title, step.command.executor, JSON.stringify(step.command), JSON.stringify(step.dependsOn ?? []), step.completion ?? step.title, goalStepFingerprint(goalId, step.id, step.command), approval]);
  }
}

export async function decideGoalStep(db: Pool, userId: string, workspaceId: string, goalId: string, id: string, fingerprint: string, decision: "approve" | "reject") {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<GoalStepRow>(`select s.* from agent_goal_steps s join agent_goals g on g.id=s.goal_id
      where s.id=$1 and g.id=$2 and g.created_by=$3 and g.workspace_id=$4 and g.status='waiting_approval'
      and s.state='waiting_approval' and s.approval='pending' and s.approval_expires_at>now() for update of s,g`, [id, goalId, userId, workspaceId]);
    const step = rows[0];
    if (!step) {
      const previous = (await client.query<GoalStepRow>("select s.* from agent_goal_steps s join agent_goals g on g.id=s.goal_id where s.id=$1 and g.id=$2 and g.created_by=$3 and g.workspace_id=$4", [id,goalId,userId,workspaceId])).rows[0];
      if (decision === "approve" && previous && ["approved","consumed"].includes(previous.approval) && previous.fingerprint === fingerprint && goalStepFingerprint(goalId, previous.step_id, previous.command) === fingerprint) { await client.query("commit"); return { ok: true }; }
      throw new Error("审批已过期或已处理，请刷新计划。");
    }
    if (fingerprint !== step.fingerprint || fingerprint !== goalStepFingerprint(goalId, step.step_id, step.command)) throw new Error("动作参数已改变，请刷新计划。");
    await client.query("update agent_goal_steps set approval=$2,state=$3,updated_at=now() where id=$1", [id, decision === "approve" ? "approved" : "rejected", decision === "approve" ? "queued" : "canceled"]);
    await client.query("update agent_goals set status=$2,updated_at=now(),error_message=$3 where id=$1", [goalId, decision === "approve" ? "running" : "canceled", decision === "approve" ? null : "用户拒绝了步骤审批。此前已完成动作未回滚。"]);
    await stepEvent(client, goalId, `goal.step_${decision}`, step.title, { stepId: step.step_id, fingerprint });
    await client.query("commit");
    return { ok: true };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function reviewGoalStep(db: Pool, userId: string, workspaceId: string, goalId: string, id: string, outcome: "observed_completed" | "observed_not_completed") {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<GoalStepRow>(`select s.* from agent_goal_steps s join agent_goals g on g.id=s.goal_id
      where s.id=$1 and g.id=$2 and g.created_by=$3 and g.workspace_id=$4 and s.state='review' and g.status='paused' for update of s,g`, [id, goalId, userId, workspaceId]);
    const step = rows[0];
    if (!step) throw new Error("没有可核验的中断步骤。");
    if (outcome === "observed_completed" && !step.output) throw new Error("缺少已保存的完成证据，不能标记完成。请确认未完成后重新审批。");
    await client.query("update agent_goal_steps set state=$2,approval=$3,lease_token=null,lease_until=null,error=null,updated_at=now() where id=$1", [id, outcome === "observed_completed" ? "succeeded" : "queued", requiresStepApproval(step.command) ? "pending" : "not_required"]);
    await client.query("update agent_goals set status='running',error_message=null,updated_at=now() where id=$1", [goalId]);
    await stepEvent(client, goalId, "goal.step_reviewed", "用户核验中断步骤；不会重放已完成步骤。", { stepId: step.step_id, outcome });
    await client.query("commit"); return { ok: true };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function stepEvent(db: Pick<PoolClient, "query">, goalId: string, type: string, detail: string, payload: Record<string, unknown>) {
  await db.query("insert into agent_goal_events(goal_id,event_type,detail,payload) values($1,$2,$3,$4::jsonb)", [goalId, type, detail, JSON.stringify(payload)]);
}
