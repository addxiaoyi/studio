import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { websiteWorkflow, type WorkflowGraph } from "@helstera/shared";
import { createGenerationApprovalService } from "../generation/generation-approval-service.js";
import { CanvasWorkflowService } from "./service.js";
import { GoalStepWorker, StepCanceled } from "../agent-goals/goal-step-worker.js";
import { decideGoalStep } from "../agent-goals/goal-step-store.js";
import { createCanvasWorkflowTool } from "../../agent/tools/canvas-workflow.js";
import { readWorkflowMaterial } from "./materials.js";
import { createLocalCanvasService } from "../../local-db/canvas-service.js";
import { insertLocalImageElement } from "../canvas/canvas-element-writer.js";
import { CreativeLibraryService } from "./library.js";
import { workflowReferences } from "./references.js";
import { workflowResults,reuseWorkflowResult } from "./results.js";

const connectionString = process.env.HELT_TEST_DATABASE_URL;
const schema = `canvas_flow_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString }),
  db = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const user = randomUUID(),
  workspace = randomUUID(),
  project = randomUUID(),
  canvas = randomUUID(),
  session = randomUUID();
const service = new CanvasWorkflowService(db);
const ready = (record = false) => {
  const graph = websiteWorkflow(record);
  graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
  return graph;
};
describe.skipIf(!connectionString)("canvas workflows with PostgreSQL", () => {
  beforeAll(async () => {
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(connectionString!).hostname,
      )
    )
      throw new Error("Local database required");
    await admin.query(`create schema ${schema}`);
    await db.query(
      await readFile(
        new URL("../../local-db/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const migration of [
      "20261020000000_website_capture",
      "20261020000001_website_capture_job_link",
      "20261020000002_website_capture_assistant",
      "20261022000000_desktop_agent_tasks",
      "20261022000001_website_capture_asset_links",
      "20261023000002_desktop_agent_canvas_link",
      "20261030000000_agent_goals",
      "20261030000001_agent_goal_retry",
      "20261030000002_agent_goal_background",
      "20261031000000_agent_muse_workspace",
      "20261106000003_goal_execution_steps",
      "20261108000004_canvas_workflows",
      "20261108000005_creative_library",
      "20261029000000_canvas_content_version",
      "20261017000000_automation_lifecycle",
    ])
      await db.query(
        await readFile(
          new URL(
            `../../local-db/migrations/${migration}.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    await db.query(
      await readFile(
        new URL(
          "../../local-db/migrations/20261023000000_desktop_agent_approvals.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query(
      "insert into app_users(id,email) values($1,'workflow@test.invalid')",
      [user],
    );
    await db.query(
      "insert into workspaces(id,owner_user_id,name) values($1,$2,'workflow')",
      [workspace, user],
    );
    await db.query(
      "insert into workspace_members(workspace_id,user_id) values($1,$2)",
      [workspace, user],
    );
    await db.query(
      "insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,'workflow','workflow')",
      [project, workspace, user],
    );
    await db.query(
      "insert into canvases(id,project_id,created_by,name) values($1,$2,$3,'workflow')",
      [canvas, project, user],
    );
    await db.query(
      "insert into chat_sessions(id,canvas_id,created_by,thread_id) values($1,$2,$3,$4)",
      [session, canvas, user, session],
    );
  });
  afterAll(async () => {
    await db.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });
  it("persists an incomplete draft without creating a goal", async () => {
    const draft = await service.create(
      user,
      canvas,
      websiteWorkflow(),
      randomUUID(),
    );
    expect(draft.revision).toBe(1);
    expect(
      (await db.query("select count(*)::int as n from agent_goals")).rows[0].n,
    ).toBe(0);
    await expect(
      service.run(user, canvas, draft.id, 1, randomUUID(), session),
    ).rejects.toThrow("网址");
  });
  it("stores private portable recipes idempotently and restores archived entries",async()=>{
    const library=new CreativeLibraryService(db),requestKey=randomUUID();
    const graph=ready();graph.nodes[0]!.config={kind:"asset",elementId:"secret-element",assetId:randomUUID(),mediaType:"video"};
    const input={name:"我的镜头方法",description:"可跨画布使用",requestKey,body:{kind:"workflow" as const,graph}};
    const [first,again]=await Promise.all([library.save(user,canvas,input),library.save(user,canvas,input)]);
    expect(first.id).toBe(again.id);expect(JSON.stringify(first)).not.toContain("secret-element");
    expect((await library.list(user,canvas)).filter(entry=>entry.id===first.id)).toHaveLength(1);
    await library.archive(user,canvas,first.id);expect((await library.list(user,canvas)).some(entry=>entry.id===first.id)).toBe(false);
    await library.archive(user,canvas,first.id,true);expect((await library.list(user,canvas)).some(entry=>entry.id===first.id)).toBe(true);
    const outsider=randomUUID();await db.query("insert into app_users(id,email) values($1,$2)",[outsider,`${outsider}@test.invalid`]);await db.query("insert into workspace_members(workspace_id,user_id) values($1,$2)",[workspace,outsider]);
    expect(await library.list(outsider,canvas)).toHaveLength(0);
    await expect(library.archive(outsider,canvas,first.id)).rejects.toThrow("无权访问");
    await db.query("delete from workspace_members where user_id=$1",[outsider]);
    await expect(library.list(outsider,canvas)).rejects.toThrow("权限已撤销");
  });
  it("resolves AI references from the saved canvas instead of trusting client text",async()=>{
    await db.query("update canvases set content=$2::jsonb where id=$1",[canvas,JSON.stringify({elements:[{id:"reference-text",type:"text",text:"已保存的产品说明"},{id:"deleted-text",type:"text",text:"已删除",isDeleted:true}]})]);
    expect(await workflowReferences(db,user,canvas,["reference-text","reference-text"])).toEqual([{elementId:"reference-text",kind:"text",title:"已保存的产品说明",text:"已保存的产品说明"}]);
    await expect(workflowReferences(db,user,canvas,["deleted-text"])).rejects.toThrow("已删除");
    await expect(workflowReferences(db,randomUUID(),canvas,["reference-text"])).rejects.toThrow("权限已撤销");
  });
  it("reuses a completed output without rerunning or charging and rejects expired media",async()=>{
    const draft=await service.create(user,canvas,ready(),randomUUID()),run=await service.run(user,canvas,draft.id,1,randomUUID(),session);
    const asset=randomUUID(),generated=randomUUID(),path=`results/${asset}.webm`;
    await db.query("insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type) values($1,$2,$3,'project-assets',$4,'video/webm')",[asset,workspace,user,path]);
    await db.query("insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,retention_until) values($1,$2,$3,'video',$4,'video/webm',now()+interval '1 day')",[generated,workspace,user,path]);
    await db.query("update canvases set content=$2::jsonb where id=$1",[canvas,JSON.stringify({elements:[{id:"existing-result",type:"embeddable",x:100,y:200,customData:{assetId:asset,isVideo:true}}]})]);
    await db.query("update agent_goals set status='completed' where id=$1",[run.goalId]);
    await db.query("update agent_goal_steps set state='succeeded',output=$2::jsonb where goal_id=$1 and step_id='capture'",[run.goalId,JSON.stringify({text:"既有提示词",assets:[{id:asset,mediaType:"video"}]})]);
    expect((await workflowResults(db,user,canvas,draft.id,run.goalId)).results[0]!.assets[0]!.available).toBe(true);
    const before=(await db.query("select count(*)::int as n from agent_goals")).rows[0].n;
    const input={goalId:run.goalId,nodeId:"capture",assetId:asset};
    expect((await reuseWorkflowResult(db,undefined,user,canvas,draft.id,input)).config).toMatchObject({elementId:"existing-result",assetId:asset});
    expect((await reuseWorkflowResult(db,undefined,user,canvas,draft.id,{goalId:run.goalId,nodeId:"capture"})).config).toMatchObject({kind:"text",text:"既有提示词"});
    expect((await db.query("select count(*)::int as n from agent_goals")).rows[0].n).toBe(before);
    await db.query("update generated_assets set retention_until=now()-interval '1 second' where id=$1",[generated]);
    expect((await workflowResults(db,user,canvas,draft.id,run.goalId)).results[0]!.assets[0]!.available).toBe(false);
    await expect(reuseWorkflowResult(db,undefined,user,canvas,draft.id,input)).rejects.toThrow("到期");
    await expect(workflowResults(db,user,canvas,draft.id,randomUUID())).rejects.toThrow("不存在");
  });
  it("fences stale edits and scopes access to owner and current membership", async () => {
    const draft = await service.create(user, canvas, ready(), randomUUID());
    const outcomes = await Promise.allSettled([
      service.save(user, canvas, draft.id, 1, ready()),
      service.save(user, canvas, draft.id, 1, ready()),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    await expect(service.get(randomUUID(), canvas, draft.id)).rejects.toThrow();
    await db.query(
      "delete from workspace_members where workspace_id=$1 and user_id=$2",
      [workspace, user],
    );
    await expect(service.get(user, canvas, draft.id)).rejects.toThrow("权限");
    await db.query(
      "insert into workspace_members(workspace_id,user_id) values($1,$2)",
      [workspace, user],
    );
  });
  it("atomically starts one immutable run and refuses edits until it ends", async () => {
    const draft = await service.create(user, canvas, ready(), randomUUID()),
      key = randomUUID();
    const receipts = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.run(user, canvas, draft.id, 1, key, session),
      ),
    );
    expect(new Set(receipts.map((item) => item.goalId)).size).toBe(1);
    expect(
      (
        await db.query(
          "select count(*)::int as n from canvas_workflow_runs where workflow_id=$1",
          [draft.id],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      service.save(user, canvas, draft.id, 1, ready()),
    ).rejects.toThrow("尚未结束");
    const execute = vi.fn(async () => ({
      summary: "fixture executed",
      assets: [],
    }));
    const worker = new GoalStepWorker(db, execute);
    await worker.tick();
    await worker.tick();
    await worker.tick();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(
      (
        await db.query("select status from agent_goals where id=$1", [
          receipts[0]!.goalId,
        ])
      ).rows[0].status,
    ).toBe("completed");
    await service.run(user, canvas, draft.id, 1, key, session);
    await worker.tick();
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("requires the exact recording approval and does not run on draft creation", async () => {
    const draft = await service.create(user, canvas, ready(true), randomUUID());
    const execute = vi.fn(async () => ({ summary: "fixture recorded" })),
      worker = new GoalStepWorker(db, execute);
    await worker.tick();
    expect(execute).not.toHaveBeenCalled();
    const run = await service.run(
      user,
      canvas,
      draft.id,
      1,
      randomUUID(),
      session,
    );
    await worker.tick();
    const step = (
      await db.query(
        "select * from agent_goal_steps where goal_id=$1 and step_id='capture'",
        [run.goalId],
      )
    ).rows[0];
    expect(step.state).toBe("waiting_approval");
    expect(execute).not.toHaveBeenCalled();
    await expect(
      decideGoalStep(
        db,
        user,
        workspace,
        run.goalId,
        step.id,
        "0".repeat(64),
        "approve",
      ),
    ).rejects.toThrow("参数");
    await decideGoalStep(
      db,
      user,
      workspace,
      run.goalId,
      step.id,
      step.fingerprint,
      "reject",
    );
    await worker.tick();
    expect(execute).not.toHaveBeenCalled();
  });
  it("registers a real Agent draft tool without an execution backdoor", async () => {
    const tool = createCanvasWorkflowTool(db);
    const reply = JSON.parse(
      String(
        await tool.invoke(
          { graph: ready(), requestKey: randomUUID() },
          { configurable: { user_id: user, canvas_id: canvas } },
        ),
      ),
    );
    expect(reply.status).toBe("draft");
    expect(reply.visualWorkflowId).toBeTruthy();
    expect(
      (await service.get(user, canvas, reply.visualWorkflowId)).activeGoalId,
    ).toBeNull();
  });
  it("keeps a background result that arrives between reading and saving the canvas", async () => {
    const canvasService = createLocalCanvasService(db);
    const account = { id: user } as Parameters<typeof canvasService.getCanvasWithVersion>[0];
    const before = await canvasService.getCanvasWithVersion(account, canvas);
    const receipt = await insertLocalImageElement(db, { download: async () => ({ data: Buffer.from("image"), error: null }) }, { canvasId: canvas, objectPath: "race.jpg", width: 100, height: 80, mimeType: "image/jpeg", jobId: "workflow-save-race" });
    await canvasService.saveCanvasContentWithVersion(account, canvas, before.canvas.content, before.version);
    const saved = await canvasService.getCanvasWithVersion(account, canvas);
    expect((saved.canvas.content.elements ?? []).some(el => el.id === receipt.elementId)).toBe(true);
    const deleted = { ...saved.canvas.content, elements: saved.canvas.content.elements.map(el => el.id === receipt.elementId ? { ...el, isDeleted: true } : el) };
    await canvasService.saveCanvasContentWithVersion(account, canvas, deleted, saved.version);
    expect((await canvasService.getCanvasWithVersion(account, canvas)).canvas.content.elements.find(el => el.id === receipt.elementId)?.isDeleted).toBe(true);
  });
  it("rechecks private canvas media ownership, deletion and retention", async () => {
    const assetId = randomUUID(), generated = randomUUID(), path = `workflow/${assetId}.mp4`;
    await db.query("insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type) values($1,$2,$3,'project-assets',$4,'video/mp4')", [assetId,workspace,user,path]);
    await db.query("insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,retention_until) values($1,$2,$3,'video',$4,'video/mp4',now()+interval '1 day')", [generated,workspace,user,path]);
    await db.query("update canvases set content=$2 where id=$1", [canvas,JSON.stringify({ elements: [{ id: "private-video", type: "embeddable", customData: { isVideo: true, assetId } }], appState: {}, files: {} })]);
    const source = { canvasId:canvas,workspaceId:workspace,userId:user,elementId:"private-video",assetId,mediaType:"video" as const };
    expect((await readWorkflowMaterial(db,source)).id).toBe(assetId);
    await expect(readWorkflowMaterial(db,{...source,userId:randomUUID()})).rejects.toThrow("无访问权限");
    await expect(readWorkflowMaterial(db,{...source,elementId:"unknown"})).rejects.toThrow("已删除");
    await db.query("update generated_assets set retention_until=now()-interval '1 second' where id=$1", [generated]);
    await expect(readWorkflowMaterial(db,source)).rejects.toThrow("到期");
    await db.query("update generated_assets set retention_until=now()+interval '1 day',deleted_at=now() where id=$1", [generated]);
    await expect(readWorkflowMaterial(db,source)).rejects.toThrow("已删除");
  });
  it("keeps paid workflow approval pending despite auto-approve and rejects after cancellation", async () => {
    const graph:WorkflowGraph={title:"图片创作审批",nodes:[{id:"image",title:"生成参考图",position:{x:0,y:0},config:{kind:"generate",mediaType:"image",model:"chosen-model",prompt:"木屋",aspectRatio:"16:9",duration:5,resolution:"720p"}},{id:"deliver",title:"交付",position:{x:400,y:0},config:{kind:"deliver"}}],edges:[{id:"image-deliver",source:"image",target:"deliver"}]};
    const draft=await service.create(user,canvas,graph,randomUUID());
    const run=await service.run(user,canvas,draft.id,1,randomUUID(),session);
    const step=(await db.query("select id from agent_goal_steps where goal_id=$1 and step_id='image'",[run.goalId])).rows[0].id;
    await db.query("update agent_goal_steps set state='waiting_desktop' where id=$1",[step]);
    await db.query("insert into workspace_settings(workspace_id,default_model,auto_approve_paid_generation) values($1,'test-model',true) on conflict(workspace_id) do update set auto_approve_paid_generation=true",[workspace]);
    const approvals=createGenerationApprovalService(db);
    const quote=await approvals.gate({workspaceId:workspace,userId:user,jobType:"image_generation",model:"chosen-model",payload:{prompt:"木屋",workflow_step_id:step},estimatedCredits:1,forceConfirmation:true,context:{canvasId:canvas,workflowGoalId:run.goalId,workflowStepId:step}});
    expect(quote.state).toBe("confirmation_required");
    if(quote.state!=="confirmation_required")throw new Error("Missing quote");
    await db.query("update agent_goals set status='waiting_approval' where id=$1",[run.goalId]);
    await db.query("update agent_goal_steps set output=$2::jsonb where id=$1",[step,JSON.stringify({generationApproval:{approvalId:quote.request.approvalId}})]);
    const execute=vi.fn();
    await new GoalStepWorker(db,execute).tick();
    expect(execute).not.toHaveBeenCalled();
    expect((await db.query("select status from agent_goals where id=$1",[run.goalId])).rows[0].status).toBe("waiting_approval");
    expect((await db.query("select status,job_id from generation_approvals where id=$1",[quote.request.approvalId])).rows[0]).toMatchObject({status:"pending",job_id:null});
    await db.query("update agent_goals set status='canceled' where id=$1",[run.goalId]);
    await expect(approvals.approve({approvalId:quote.request.approvalId,workspaceId:workspace,userId:user})).rejects.toThrow("取消");
    expect((await db.query("select status,job_id from generation_approvals where id=$1",[quote.request.approvalId])).rows[0]).toMatchObject({status:"pending",job_id:null});
    await db.query("update agent_goals set status='running' where id=$1",[run.goalId]);
    await db.query("update generation_approvals set status='rejected' where id=$1",[quote.request.approvalId]);
    await new GoalStepWorker(db,async()=>{throw new StepCanceled("用户取消费用确认");}).tick();
    expect((await db.query("select status from agent_goals where id=$1",[run.goalId])).rows[0].status).toBe("canceled");
  });
});
