import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AgentGoalPlan, GoalCommand } from "@helstera/shared";
import { goalStepFingerprint, stepEvent, type GoalStepRow } from "./goal-step-store.js";
import { shouldSkipStep } from "./step-routing.js";

export type ExecutingGoal = { id: string; created_by: string; workspace_id: string; canvas_id: string | null; chat_session_id: string | null; goal: string; plan: AgentGoalPlan; execution_mode: string; output_kind: string };
export type StepExecution = { goal: ExecutingGoal; step: GoalStepRow; previous: GoalStepRow[]; signal: AbortSignal; assertActive(): Promise<void> };
export type StepExecutor = (input: StepExecution) => Promise<Record<string, unknown>>;
export class StepCanceled extends Error {}
export class StepWaiting extends Error { constructor(readonly output: Record<string, unknown>, readonly waiting: "waiting_desktop" | "waiting_approval" = "waiting_desktop") { super("步骤正在等待执行器"); } }

export class GoalStepWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly active = new Map<string, AbortController>();
  private stopped = false;
  private scanning: Promise<Promise<void>[]> | undefined;
  private readonly pending = new Set<Promise<void>>();
  constructor(private readonly db: Pool, private readonly execute: StepExecutor, private readonly concurrency = 4) {}
  start() { if (this.timer) return; this.stopped = false; this.timer = setInterval(() => void this.tick(), 1000); this.timer.unref(); void this.tick(); }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.active.values()) controller.abort();
    await this.scanning;
    await Promise.all([...this.pending]);
  }
  async tick(): Promise<void> {
    if (this.stopped) return;
    this.scanning ??= this.scan().finally(() => { this.scanning = undefined; });
    await Promise.all(await this.scanning);
  }
  private async scan(): Promise<Promise<void>[]> {
    try {
      const goals = await this.db.query<ExecutingGoal>(`select * from agent_goals where plan->>'version'='2'
        and status in ('running','waiting_approval','waiting_desktop') and confirmed_at is not null and execution_policy='approval_required'
        order by updated_at limit 40`);
      const pending: Promise<void>[] = [];
      for (const goal of goals.rows) {
        if (this.stopped) break;
        if (this.active.size >= this.concurrency) break;
        if (this.active.has(goal.id)) continue;
        const controller = new AbortController(); this.active.set(goal.id, controller);
        const task = this.process(goal, controller).catch(error => console.error("[goal-steps] processing failed", { goalId: goal.id, error })).finally(() => { this.active.delete(goal.id); this.pending.delete(task); });
        this.pending.add(task);
        pending.push(task);
      }
      return pending;
    } catch (error) { console.error("[goal-steps] queue scan failed", error); return []; }
  }
  private async claim(goal: ExecutingGoal): Promise<{ step: GoalStepRow; previous: GoalStepRow[] } | null> {
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const lock = await client.query("select id from agent_goals where id=$1 and status in ('running','waiting_approval','waiting_desktop') and confirmed_at is not null for update skip locked", [goal.id]);
      if (!lock.rows.length) { await client.query("rollback"); return null; }
      const previous = (await client.query<GoalStepRow>("select * from agent_goal_steps where goal_id=$1 order by ordinal for update", [goal.id])).rows;
      const step = previous.find(item => item.state !== "succeeded");
      if (!step || ["failed", "canceled", "review"].includes(step.state)) { await client.query("commit"); return null; }
      const depends = step.depends_on.every(id => previous.some(item => item.step_id === id && item.state === "succeeded"));
      if (!depends) throw new Error("步骤依赖未完成。");
      if(shouldSkipStep(goal.plan,step,previous)){
        await client.query("update agent_goal_steps set state='succeeded',output=$2::jsonb,error=null,updated_at=now() where id=$1",[step.id,JSON.stringify({skipped:true,reason:"IF 分支未命中或上游已跳过"})]);
        await this.planState(client,goal,step.step_id,"skipped");
        await stepEvent(client,goal.id,"goal.step_skipped",step.title,{stepId:step.step_id});
        await client.query("commit");return null;
      }
      if(step.executor==="flow.delay"&&step.state==="waiting_desktop"&&typeof step.output?.resumeAt==="string"&&Date.parse(step.output.resumeAt)>Date.now()){await client.query("commit");return null;}
      if (step.executor === "media.generate" && step.state === "waiting_desktop" && step.output?.generationApproval) {
        const approvalId = (step.output.generationApproval as { approvalId?: unknown }).approvalId;
        const pending = typeof approvalId === "string" ? await client.query("select id from generation_approvals where id=$1 and workspace_id=$2 and user_id=$3 and status='pending' and expires_at>now()",[approvalId,goal.workspace_id,goal.created_by]) : null;
        if (pending?.rows.length) { await client.query("commit"); return null; }
      }
      if (step.state === "running") {
        const expired = await client.query("select id from agent_goal_steps where id=$1 and lease_until<now()", [step.id]);
        if (!expired.rows.length) { await client.query("commit"); return null; }
        if (step.approval === "consumed") {
          let evidence = step.output;
          if (!evidence && step.executor === "web.capture") evidence = (await client.query("select result from website_capture_tasks where id=$1 and created_by=$2 and workspace_id=$3 and status='succeeded'", [step.id,goal.created_by,goal.workspace_id])).rows[0]?.result ?? null;
          if (!evidence && step.executor === "media.trim") {
            const asset = (await client.query(`select ao.id from generated_assets ga join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path
              where ga.metadata->>'videoExportUploadId'=$1 and ao.created_by=$2 and ao.workspace_id=$3 and ga.retention_until>now() and ga.deleted_at is null and ga.retention_state='active'`, [step.id,goal.created_by,goal.workspace_id])).rows[0];
            if (asset) evidence = { recordingAssetId: asset.id, assets: [{ id: asset.id, mediaType: "video", url: `/api/uploads/${asset.id}/file` }], recoveredReceipt: true };
          }
          await client.query("update agent_goal_steps set state='review',output=$2::jsonb,error='执行回执不确定，需要人工核验。',updated_at=now() where id=$1", [step.id,evidence ? JSON.stringify(evidence) : null]);
          await client.query("update agent_goals set status='paused',error_message='已批准动作中断，请核验后继续。',updated_at=now() where id=$1", [goal.id]);
          await stepEvent(client, goal.id, "goal.step_uncertain", step.title, { stepId: step.step_id, command: step.command });
          await client.query("commit"); return null;
        }
      }
      if (step.command.executor === "web.capture" && step.command.fromStep) {
        const fromStep = step.command.fromStep;
        const search = previous.find(item => item.step_id === fromStep)?.output;
        if (typeof search?.url !== "string") throw new Error("搜索没有返回可核验的网址。");
        const { fromStep: _source, ...capture } = step.command;
        step.command = { ...capture, url: search.url };
        step.fingerprint = goalStepFingerprint(goal.id, step.step_id, step.command);
        await client.query("update agent_goal_steps set command=$2::jsonb,fingerprint=$3 where id=$1", [step.id, JSON.stringify(step.command), step.fingerprint]);
      }
      if (step.fingerprint !== goalStepFingerprint(goal.id, step.step_id, step.command)) throw new Error("动作指纹不匹配，拒绝执行。");
      if (step.command.executor === "media.trim" && !step.command.sourceAssetId) {
        const fromStep = step.command.fromStep;
        const assetId = previous.find(item => item.step_id === fromStep)?.output?.recordingAssetId;
        if (typeof assetId !== "string") throw new Error("剪辑来源尚未保存。");
        step.command = { ...step.command, sourceAssetId: assetId };
        step.fingerprint = goalStepFingerprint(goal.id, step.step_id, step.command);
        await client.query("update agent_goal_steps set command=$2::jsonb,fingerprint=$3 where id=$1", [step.id, JSON.stringify(step.command), step.fingerprint]);
      }
      if (step.approval === "pending" || step.approval === "expired" || step.approval === "approved" && (!step.approval_expires_at || step.approval_expires_at.getTime() <= Date.now())) {
        const changed = await client.query(`update agent_goal_steps set state='waiting_approval',approval='pending',approval_expires_at=now()+interval '15 minutes',updated_at=now()
          where id=$1 and (state<>'waiting_approval' or approval_expires_at<=now()) returning id`, [step.id]);
        await client.query("update agent_goals set status='waiting_approval',updated_at=now() where id=$1", [goal.id]);
        if (changed.rows.length) await stepEvent(client, goal.id, "goal.step_approval", step.title, { stepId: step.step_id, command: step.command, fingerprint: step.fingerprint });
        await client.query("commit"); return null;
      }
      const token = randomUUID();
      const claimed = (await client.query<GoalStepRow>(`update agent_goal_steps set state='running',attempt=attempt+case when state='waiting_desktop' then 0 else 1 end,lease_token=$2,lease_until=now()+interval '90 seconds',
        approval=case when approval='approved' then 'consumed' else approval end,updated_at=now() where id=$1 returning *`, [step.id, token])).rows[0]!;
      await client.query("update agent_goals set status='running',error_message=null,updated_at=now() where id=$1", [goal.id]);
      await this.planState(client, goal, step.step_id, "running");
      if (step.state !== "waiting_desktop") await stepEvent(client, goal.id, "goal.step_started", step.title, { stepId: step.step_id, attempt: claimed.attempt, executor: step.executor });
      await client.query("commit"); return { step: claimed, previous };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  private async process(goal: ExecutingGoal, controller: AbortController) {
    let work: Awaited<ReturnType<GoalStepWorker["claim"]>>;
    try { work = await this.claim(goal); }
    catch (error) {
      await this.db.query("update agent_goals set status='failed',error_message=$2,updated_at=now() where id=$1 and status in ('running','waiting_approval','waiting_desktop')", [goal.id, error instanceof Error ? error.message.slice(0,1000) : "步骤校验失败"]);
      throw error;
    }
    if (!work) return;
    const { step, previous } = work;
    const assertActive = async () => {
      controller.signal.throwIfAborted();
      const kept = await this.db.query(`update agent_goal_steps s set lease_until=now()+interval '90 seconds',updated_at=now() from agent_goals g
        where s.id=$1 and s.lease_token=$2 and s.state='running' and s.lease_until>now() and g.id=s.goal_id and g.status='running' returning s.id`, [step.id, step.lease_token]);
      if (!kept.rows.length) { controller.abort(); throw new Error("目标已暂停、取消或执行租约失效。"); }
    };
    let checking: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      checking ??= assertActive().catch(() => controller.abort()).finally(() => { checking = undefined; });
    }, 2000);
    let evidence: Record<string, unknown> | undefined;
    try {
      await assertActive();
      const output = await this.execute({ goal, step, previous, signal: controller.signal, assertActive });
      evidence = output;
      await assertActive();
      const client = await this.db.connect();
      try {
        await client.query("begin");
        const locked = await client.query("select id from agent_goals where id=$1 and status='running' for update", [goal.id]);
        if (!locked.rows.length) throw new Error("目标已停止，保留结果待核验。");
        const saved = await client.query("update agent_goal_steps set state='succeeded',output=$3::jsonb,error=null,lease_token=null,lease_until=null,updated_at=now() where id=$1 and lease_token=$2 and state='running' and lease_until>now() returning id", [step.id, step.lease_token, JSON.stringify(output)]);
        if (!saved.rows.length) throw new Error("步骤完成回执未被接受。");
        await this.planState(client, goal, step.step_id, "succeeded");
        await stepEvent(client, goal.id, "goal.step_completed", step.title, { stepId: step.step_id, output });
        if (step.executor === "result.deliver") await this.complete(client, goal, output);
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    } catch (error) {
      if (error instanceof StepCanceled) {
        await this.db.query("update agent_goal_steps set state='canceled',error=$2,lease_token=null,lease_until=null,updated_at=now() where goal_id=$1 and state<>'succeeded'",[goal.id,error.message]);
        await this.db.query("update agent_goals set status='canceled',error_message=$2,completed_at=now(),updated_at=now() where id=$1 and status in ('running','waiting_approval','waiting_desktop')",[goal.id,error.message]);
        await stepEvent(this.db,goal.id,"goal.canceled",error.message,{stepId:step.step_id});
      } else if (error instanceof StepWaiting) {
        await this.db.query("update agent_goal_steps set state='waiting_desktop',output=$3::jsonb,lease_token=null,lease_until=null,updated_at=now() where id=$1 and lease_token=$2", [step.id, step.lease_token, JSON.stringify(error.output)]);
        await this.db.query("update agent_goals set status=$2,updated_at=now() where id=$1 and status='running'", [goal.id, error.waiting]);
      } else {
        const uncertain = step.approval === "consumed";
        const state = uncertain ? "review" : controller.signal.aborted ? "queued" : "failed";
        await this.db.query("update agent_goal_steps set state=$3,error=$4,output=coalesce($5::jsonb,output),lease_token=null,lease_until=null,updated_at=now() where id=$1 and lease_token=$2 and state='running'", [step.id, step.lease_token, state, error instanceof Error ? error.message.slice(0,1000) : "步骤失败", evidence ? JSON.stringify(evidence) : null]);
        if (!controller.signal.aborted || uncertain) await this.db.query("update agent_goals set status=$2,error_message=$3,updated_at=now() where id=$1 and status in ('running','paused')", [goal.id, uncertain ? "paused" : "failed", error instanceof Error ? error.message.slice(0,1000) : "步骤失败"]);
        await stepEvent(this.db, goal.id, "goal.step_interrupted", error instanceof Error ? error.message.slice(0,1000) : "步骤失败", { stepId: step.step_id, state });
      }
    } finally { clearInterval(heartbeat); await checking; }
  }
  private async planState(db: Pick<PoolClient, "query">, goal: ExecutingGoal, stepId: string, status: "running" | "succeeded" | "skipped") {
    await db.query(`update agent_goals set plan=jsonb_set(plan,'{steps}',(select jsonb_agg(case when item->>'id'=$2 then jsonb_set(item,'{status}',to_jsonb($3::text)) else item end order by n) from jsonb_array_elements(plan->'steps') with ordinality as steps(item,n))),updated_at=now() where id=$1`, [goal.id, stepId, status]);
  }
  private async complete(db: PoolClient, goal: ExecutingGoal, output: Record<string, unknown>) {
    const remaining = await db.query("select id from agent_goal_steps where goal_id=$1 and state<>'succeeded' limit 1", [goal.id]);
    if (remaining.rows.length) throw new Error("仍有未完成步骤，不能报告目标完成。");
    await db.query("update agent_goals set status='completed',result=$2::jsonb,completed_at=now(),updated_at=now() where id=$1", [goal.id, JSON.stringify(output)]);
    const assets = Array.isArray(output.assets) ? output.assets as Array<Record<string, unknown>> : [];
    const videos = assets.filter(asset => asset.mediaType === "video" && typeof asset.id === "string");
    const objects = videos.length ? (await db.query<{ id: string }>(`select distinct ao.id from asset_objects ao left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
      where (ao.id=any($1::uuid[]) or ga.id=any($1::uuid[])) and ao.workspace_id=$2 and ao.created_by=$3`, [videos.map(asset=>asset.id),goal.workspace_id,goal.created_by])).rows : [];
    const blocks = objects.map(asset => ({ type: "tool", toolCallId: `goal-video:${goal.id}:${asset.id}`, toolName: "video_export", status: "completed", output: { assetId: asset.id }, outputSummary: "目标成片" }));
    if (goal.chat_session_id) await db.query(`insert into chat_messages(session_id,role,content,content_blocks,client_message_id) select id,'assistant',$2,$5::jsonb,$3 from chat_sessions where id=$1 and created_by=$4 on conflict(session_id,client_message_id) do nothing`, [goal.chat_session_id, String(output.summary ?? "目标已完成。").slice(0,12000), `agent-goal:${goal.id}:completed`, goal.created_by,JSON.stringify(blocks)]);
    const documents = Array.isArray(output.documents) ? output.documents as Array<Record<string, unknown>> : [];
    for (const document of documents) {
      await db.query(`insert into agent_goal_outputs(id,goal_id,kind,status,metadata)
        select gen_random_uuid(),$1,'document','pending',$2::jsonb where not exists(select 1 from agent_goal_outputs where goal_id=$1 and metadata->>'documentId'=$3)`, [goal.id, JSON.stringify({ documentId: document.id, title: document.title, fileName: document.fileName, saveState: "pending_local" }), document.id]);
    }
    for (const path of Array.isArray(output.localPaths) ? output.localPaths : []) {
      if (typeof path !== "string") continue;
      await db.query("insert into agent_goal_outputs(id,goal_id,kind,local_path,status,metadata) values(gen_random_uuid(),$1,'local_file',$2,'pending',$3::jsonb)", [goal.id,path,JSON.stringify({saveState:"pending_verification",reason:"需要桌面文件摘要和保存回执"})]);
    }
    for (const asset of assets) {
      await db.query(`insert into agent_goal_outputs(id,goal_id,kind,cloud_asset_id,status,metadata)
        select gen_random_uuid(),$1,$2,$3,'saved_cloud',$4::jsonb where not exists(select 1 from agent_goal_outputs where goal_id=$1 and cloud_asset_id=$3)`, [goal.id, asset.mediaType ?? "asset", asset.id, JSON.stringify(asset)]);
    }
    await stepEvent(db, goal.id, "goal.completed", "全部步骤及结果交付已完成。", output);
  }
}
