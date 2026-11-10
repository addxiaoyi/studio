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
import { assertWorkflowJobGenerationActive } from "./approval-access.js";
import {WorkflowAssistantService} from "./assistant.js";
import {executeLogicNode} from "./logic-executor.js";
import {executeCreativeNode} from "./creative-executor.js";
import {readPinnedOutput} from "./pins.js";
const logicGraph=():WorkflowGraph=>({title:"分支验收",nodes:[
  {id:"source",title:"资料",position:{x:0,y:0},config:{kind:"text",role:"story",text:"Hello"}},
  {id:"check",title:"条件",position:{x:400,y:0},config:{kind:"condition",conditions:[{field:"text",operator:"contains",value:"Hello"}],match:"all"}},
  {id:"yes",title:"命中",position:{x:800,y:0},config:{kind:"transform",operation:"uppercase",search:"",replacement:""}},
  {id:"no",title:"未命中",position:{x:800,y:300},config:{kind:"template",template:"{{text}}"}},
  {id:"merge",title:"合并",position:{x:1200,y:0},config:{kind:"merge",separator:"\n"}},
  {id:"output",title:"输出",position:{x:1600,y:0},config:{kind:"deliver"}},
],edges:[{id:"a",source:"source",target:"check"},{id:"b",source:"check",target:"yes",branch:"true"},{id:"c",source:"check",target:"no",branch:"false"},{id:"d",source:"yes",target:"merge"},{id:"e",source:"no",target:"merge"},{id:"f",source:"merge",target:"output"}]});

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
      "20261108000006_workflow_assistant",
      "20261109000000_workflow_partial_runs",
      "20261110000000_workflow_budget",
        "20261109000001_workflow_versions",
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
  it("enforces one shared budget for concurrent approvals, retries and changed prices", async () => {
    const graph:WorkflowGraph={title:"预算并发验收",nodes:[
      ...["first","second"].map(id=>({id,title:id,position:{x:0,y:0},config:{kind:"generate" as const,mediaType:"image" as const,model:"budget-model",prompt:id,aspectRatio:"16:9" as const,duration:5,resolution:"720p" as const}})),
      {id:"deliver",title:"交付",position:{x:900,y:0},config:{kind:"deliver"}},
    ],edges:[{id:"a",source:"first",target:"deliver"},{id:"b",source:"second",target:"deliver"}]};
    const draft=await service.create(user,canvas,graph,randomUUID()),key=randomUUID();
    const run=await service.run(user,canvas,draft.id,1,key,session,undefined,2);
    expect(await service.run(user,canvas,draft.id,1,key,session,undefined,2)).toEqual({goalId:run.goalId,reused:true});
    await expect(service.run(user,canvas,draft.id,1,key,session,undefined,3)).rejects.toThrow("不一致");
    await db.query("update agent_goal_steps set state='waiting_desktop' where goal_id=$1",[run.goalId]);
    const steps=(await db.query("select id from agent_goal_steps where goal_id=$1 and executor='media.generate' order by ordinal",[run.goalId])).rows;
    const approvals=createGenerationApprovalService(db);
    const requests=await Promise.all(steps.map(async step=>{
      const quote=await approvals.gate({workspaceId:workspace,userId:user,jobType:"image_generation",model:"budget-model",payload:{prompt:"budget",workflow_step_id:step.id},estimatedCredits:1.2,forceConfirmation:true,context:{canvasId:canvas,workflowGoalId:run.goalId,workflowStepId:step.id}});
      if(quote.state!=="confirmation_required")throw Error("Missing confirmation");
      return {approvalId:quote.request.approvalId,workspaceId:workspace,userId:user};
    }));
    const confirmations=await Promise.allSettled(requests.map(request=>approvals.approve(request)));
    expect(confirmations.filter(item=>item.status==="fulfilled")).toHaveLength(1);
    expect(confirmations.filter(item=>item.status==="rejected").map(item=>(item as PromiseRejectedResult).reason.message)).toEqual([expect.stringContaining("预算上限")]);
    const accepted=requests[confirmations.findIndex(item=>item.status==="fulfilled")]!;
    await Promise.all([approvals.approve(accepted),approvals.approve(accepted)]);
    const history=await service.runs(user,canvas,draft.id);
    expect(history[0]).toMatchObject({budgetCredits:2,reservedCredits:1.2});
    await expect(db.query("update generation_approvals set estimated_credits=1.9 where id=$1",[accepted.approvalId])).rejects.toThrow("workflow_budget_quote_changed");
    await db.query("update agent_goals set status='canceled' where id=$1",[run.goalId]);
    const zero=await service.run(user,canvas,draft.id,1,randomUUID(),session);
    expect((await service.runs(user,canvas,draft.id))[0]).toMatchObject({budgetCredits:0,reservedCredits:0});
    const zeroStep=(await db.query("select id from agent_goal_steps where goal_id=$1 and executor='media.generate' limit 1",[zero.goalId])).rows[0].id;
    await db.query("update agent_goal_steps set state='waiting_desktop' where id=$1",[zeroStep]);
    const quote=await approvals.gate({workspaceId:workspace,userId:user,jobType:"image_generation",model:"budget-model",payload:{prompt:"zero",workflow_step_id:zeroStep},estimatedCredits:0.01,forceConfirmation:true,context:{canvasId:canvas,workflowGoalId:zero.goalId,workflowStepId:zeroStep}});
    if(quote.state!=="confirmation_required")throw Error("Missing zero-budget confirmation");
    await expect(approvals.approve({approvalId:quote.request.approvalId,workspaceId:workspace,userId:user})).rejects.toThrow("预算上限");
    await approvals.reject({approvalId:quote.request.approvalId,workspaceId:workspace,userId:user});
    expect((await service.runs(user,canvas,draft.id))[0]).toMatchObject({reservedCredits:0});
    await db.query("update agent_goals set status='canceled' where id=$1",[zero.goalId]);
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
    expect(reply.status).toBe("confirmation_required");
    expect(reply.workflowProposalId).toBeTruthy();
    const proposals=new WorkflowAssistantService(db);const pending=await proposals.get(user,canvas,reply.workflowProposalId);expect(pending.workflowId).toBeNull();
    const applied=await proposals.decide(user,canvas,pending.id,"confirm",true);expect((await service.get(user,canvas,String(applied.result!.workflowId))).activeGoalId).toBeNull();
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
  it("revalidates embedded references at fee confirmation without charging deleted or expired media", async () => {
    const asset = randomUUID(), generated = randomUUID(), path = `workflow/${asset}.png`;
    await db.query("insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type) values($1,$2,$3,'project-assets',$4,'image/png')", [asset,workspace,user,path]);
    await db.query("insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,retention_until) values($1,$2,$3,'image',$4,'image/png',now()+interval '1 day')", [generated,workspace,user,path]);
    const element = { id: "billing-reference", type: "image", customData: { assetId: asset } };
    await db.query("update canvases set content=$2::jsonb where id=$1", [canvas, JSON.stringify({elements:[element]})]);
    const graph: WorkflowGraph = {title:"参考图费用确认",nodes:[
      {id:"reference",title:"参考照片",position:{x:0,y:0},config:{kind:"asset",elementId:element.id,assetId:asset,mediaType:"image"}},
      {id:"generate",title:"生成",position:{x:400,y:0},config:{kind:"generate",mediaType:"image",model:"chosen-model",prompt:"保持角色",aspectRatio:"16:9",duration:5,resolution:"720p"}},
      {id:"deliver",title:"交付",position:{x:800,y:0},config:{kind:"deliver"}},
    ],edges:[{id:"ref-gen",source:"reference",target:"generate"},{id:"gen-out",source:"generate",target:"deliver"}]};
    const draft = await service.create(user,canvas,graph,randomUUID());
    const run = await service.run(user,canvas,draft.id,1,randomUUID(),session,undefined,1);
    const step = (await db.query("select id from agent_goal_steps where goal_id=$1 and step_id='generate'",[run.goalId])).rows[0].id;
    await db.query("update agent_goal_steps set state='waiting_desktop' where id=$1",[step]);
    const approvals=createGenerationApprovalService(db);
    const quote=await approvals.gate({workspaceId:workspace,userId:user,jobType:"image_generation",model:"chosen-model",payload:{prompt:"保持角色",input_asset_ids:[asset],workflow_step_id:step},estimatedCredits:1,forceConfirmation:true,context:{canvasId:canvas,workflowGoalId:run.goalId,workflowStepId:step}});
    if(quote.state!=="confirmation_required")throw new Error("Missing quote");
    const request={approvalId:quote.request.approvalId,workspaceId:workspace,userId:user};
    const before=(await db.query("select count(*)::int as n from credit_transactions")).rows[0].n;
    await db.query("update canvases set content=$2::jsonb where id=$1",[canvas,JSON.stringify({elements:[{...element,isDeleted:true}]})]);
    await expect(approvals.approve(request)).rejects.toThrow("已删除");
    await db.query("update canvases set content=$2::jsonb where id=$1",[canvas,JSON.stringify({elements:[element]})]);
    await db.query("update generated_assets set retention_until=now()-interval '1 second' where id=$1",[generated]);
    await expect(approvals.approve(request)).rejects.toThrow("到期");
    expect((await db.query("select status,job_id from generation_approvals where id=$1",[request.approvalId])).rows[0]).toMatchObject({status:"pending",job_id:null});
    expect((await db.query("select count(*)::int as n from credit_transactions")).rows[0].n).toBe(before);
    await db.query("update generated_assets set retention_until=now()+interval '1 day' where id=$1",[generated]);
    expect((await approvals.approve(request)).parameters.input_asset_ids).toEqual([asset]);
    const jobId=randomUUID();
    await db.query("insert into background_jobs(id,workspace_id,canvas_id,created_by,queue_name,job_type,idempotency_key,payload,credits_cost) values($1,$2,$3,$4,'image_generation_jobs','image_generation',$5,$6::jsonb,1)",[jobId,workspace,canvas,user,`approval:${request.approvalId}`,JSON.stringify(quote.request.parameters)]);
    const queued={jobId,stepId:step,workspaceId:workspace,userId:user};
    await expect(assertWorkflowJobGenerationActive(db,queued)).rejects.toThrow("已消费费用确认");
    await db.query("update background_jobs set credits_transaction_id=$2 where id=$1",[jobId,randomUUID()]);
    await assertWorkflowJobGenerationActive(db,queued);
    await assertWorkflowJobGenerationActive(db,queued);
    expect((await approvals.approve(request)).jobId).toBe(jobId);
    expect((await db.query("select count(*)::int as n from credit_transactions")).rows[0].n).toBe(before);
    await db.query("update agent_goals set status='canceled' where id=$1",[run.goalId]);
  });
  it("applies AI edits once, rejects stale versions and keeps execution behind a separate confirmation",async()=>{
    const assistant=new WorkflowAssistantService(db),draft=await service.create(user,canvas,ready(),randomUUID());
    const changed={...draft.graph,title:"AI 修改后的研究流程"};
    const proposal=await assistant.propose(user,canvas,{workflowId:draft.id,revision:draft.revision,prompt:"改名字",requestKey:randomUUID(),plan:{action:"edit",summary:"修改名称，保留节点和素材。",graph:changed}});
    expect((await service.get(user,canvas,draft.id)).graph.title).toBe(draft.graph.title);
    await expect(assistant.get(randomUUID(),canvas,proposal.id)).rejects.toThrow("权限");
    const applied=await assistant.decide(user,canvas,proposal.id,"confirm",true);const replay=await assistant.decide(user,canvas,proposal.id,"confirm",true);expect(replay.result).toEqual(applied.result);expect((await service.get(user,canvas,draft.id)).revision).toBe(2);
    const stale=await assistant.propose(user,canvas,{workflowId:draft.id,revision:2,prompt:"再次改名",requestKey:randomUUID(),plan:{action:"edit",summary:"改名",graph:{...changed,title:"过时方案"}}});
    await service.save(user,canvas,draft.id,2,{...changed,title:"用户先修改了"});await expect(assistant.decide(user,canvas,stale.id,"confirm",true)).rejects.toThrow("其他窗口");
    const start=await assistant.propose(user,canvas,{workflowId:draft.id,revision:3,prompt:"运行",requestKey:randomUUID(),plan:{action:"run",summary:"运行第3版"}});expect((await service.get(user,canvas,draft.id)).activeGoalId).toBeNull();
    await expect(assistant.decide(user,canvas,start.id,"confirm",false)).rejects.toThrow("尚未启用");
    const executed=await assistant.decide(user,canvas,start.id,"confirm",true),again=await assistant.decide(user,canvas,start.id,"confirm",true);expect(again.result).toEqual(executed.result);expect((await service.runs(user,canvas,draft.id))).toHaveLength(1);
    const pause=await assistant.propose(user,canvas,{workflowId:draft.id,prompt:"暂停",requestKey:randomUUID(),plan:{action:"pause",summary:"暂停当前运行"}});await assistant.decide(user,canvas,pause.id,"confirm",true);expect((await assistant.context(user,canvas,draft.id)).goal!.status).toBe("paused");
    const resume=await assistant.propose(user,canvas,{workflowId:draft.id,prompt:"继续",requestKey:randomUUID(),plan:{action:"resume",summary:"继续未完成步骤"}});await db.query("update agent_goal_steps set state='review' where goal_id=$1 and step_id='capture'",[executed.result!.goalId]);await expect(assistant.decide(user,canvas,resume.id,"confirm",true)).rejects.toThrow("核验");
    const cancel=await assistant.propose(user,canvas,{workflowId:draft.id,prompt:"取消",requestKey:randomUUID(),plan:{action:"cancel",summary:"取消"}});await assistant.decide(user,canvas,cancel.id,"confirm",true);
    const expired=await assistant.propose(user,canvas,{prompt:"新建",requestKey:randomUUID(),plan:{action:"edit",summary:"新草稿",graph:ready()}});await db.query("update canvas_workflow_proposals set expires_at=now()-interval '1 second' where id=$1",[expired.id]);await expect(assistant.decide(user,canvas,expired.id,"confirm",true)).rejects.toThrow("过期");
    expect((await assistant.decide(user,canvas,expired.id,"reject",true)).status).toBe("rejected");
  });
  it("binds a partial run to its target, excludes unrelated branches and keeps recording approval",async()=>{
    const graph=ready(true);
    graph.nodes.push({id:"unused",title:"未配置生成",position:{x:0,y:600},config:{kind:"generate",mediaType:"image",model:"",prompt:"",aspectRatio:"16:9",duration:5,resolution:"720p"}});
    const draft=await service.create(user,canvas,graph,randomUUID()),key=randomUUID();
    await expect(service.run(randomUUID(),canvas,draft.id,1,key,session,"capture")).rejects.toThrow("权限");
    const first=await service.run(user,canvas,draft.id,1,key,session,"capture");
    const replay=await service.run(user,canvas,draft.id,1,key,session,"capture");
    expect(replay).toEqual({goalId:first.goalId,reused:true});
    await expect(service.run(user,canvas,draft.id,1,key,session)).rejects.toThrow("不一致");
    const execute=vi.fn(async()=>({}));
    await new GoalStepWorker(db,execute).tick();
    const steps=(await db.query("select step_id,state,command from agent_goal_steps where goal_id=$1 order by ordinal",[first.goalId])).rows;
    expect(steps.map(step=>step.step_id)).toEqual(["capture","preview-output"]);
    expect(steps[0]).toMatchObject({state:"waiting_approval",command:{record:true,pageLimit:1,url:"https://example.com"}});
    expect(execute).not.toHaveBeenCalled();
    expect((await service.get(user,canvas,draft.id)).graph).toEqual(graph);
    expect((await service.runs(user,canvas,draft.id))[0]).toMatchObject({targetNodeId:"capture",revision:1});
    await db.query("update agent_goals set status='canceled' where id=$1",[first.goalId]);
    const assistant=new WorkflowAssistantService(db);
    const proposed=await assistant.propose(user,canvas,{workflowId:draft.id,revision:1,requestKey:randomUUID(),prompt:"仅执行录制节点",plan:{action:"run",targetNodeId:"capture",summary:"执行录制及其必要上游"}});
    expect(proposed).toMatchObject({targetNodeId:"capture",status:"pending"});
    expect(await service.runs(user,canvas,draft.id)).toHaveLength(1);
    const approved=await assistant.decide(user,canvas,proposed.id,"confirm",true);
    expect((await assistant.decide(user,canvas,proposed.id,"confirm",true)).result).toEqual(approved.result);
    expect((await service.runs(user,canvas,draft.id))[0]).toMatchObject({targetNodeId:"capture"});
    await db.query("update agent_goals set status='canceled' where id=$1",[approved.result!.goalId]);
  });
  it("skips the false generation branch before executor approval and never charges it",async()=>{
    const graph=logicGraph();graph.nodes.find(node=>node.id==="no")!.config={kind:"generate",mediaType:"image",model:"test",prompt:"never generate",aspectRatio:"16:9",duration:5,resolution:"720p"};
    graph.edges=graph.edges.filter(edge=>edge.id!=="e");graph.edges.push({id:"no-output",source:"no",target:"output"});
    const draft=await service.create(user,canvas,graph,randomUUID()),receipt=await service.run(user,canvas,draft.id,1,randomUUID(),session);
    const effects=vi.fn();const worker=new GoalStepWorker(db,async input=>{if(input.step.executor==="media.generate"){effects();throw Error("False branch executed");}return await executeLogicNode(input)??(input.step.executor==="content.text"?{text:"  Hello  "}:{summary:"branch done"});});
    for(let i=0;i<8;i++)await worker.tick();
    expect(effects).not.toHaveBeenCalled();expect((await db.query("select status from agent_goals where id=$1",[receipt.goalId])).rows[0].status).toBe("completed");
    const skipped=(await db.query("select state,approval,attempt,output from agent_goal_steps where goal_id=$1 and step_id='no'",[receipt.goalId])).rows[0];expect(skipped).toMatchObject({state:"succeeded",attempt:0,output:{skipped:true}});
  });
  it("records every save, previews history and restores atomically without executing",async()=>{
    const draft=await service.create(user,canvas,ready(),randomUUID());
    await service.save(user,canvas,draft.id,1,{...draft.graph,title:"第二版"});
    expect((await service.versions(user,canvas,draft.id)).map(version=>version.revision)).toEqual([2,1]);
    await expect(service.versions(randomUUID(),canvas,draft.id)).rejects.toThrow("权限");
    await expect(service.restore(user,canvas,draft.id,1,1)).rejects.toThrow("版本已变化");
    const restored=await service.restore(user,canvas,draft.id,2,1);
    expect(restored).toMatchObject({revision:3,activeGoalId:null,graph:{title:draft.graph.title}});
    expect((await service.versions(user,canvas,draft.id))[0]).toMatchObject({revision:3,restoredFrom:1});
    expect(await service.runs(user,canvas,draft.id)).toHaveLength(0);
    const run=await service.run(user,canvas,draft.id,3,randomUUID(),session);
    await expect(service.restore(user,canvas,draft.id,3,2)).rejects.toThrow("尚未结束");
    await db.query("update agent_goals set status='canceled' where id=$1",[run.goalId]);
  });
  it("resumes real batch checkpoints after worker replacement without duplicating items",async()=>{
    const position={x:0,y:0};
    const graph:WorkflowGraph={title:"批量",nodes:[
      {id:"source",title:"列表",position,config:{kind:"json",json:'["a","b","c","d","e"]'}},
      {id:"split",title:"拆分",position,config:{kind:"split",source:"json",path:"",separator:"\n",maxItems:5}},
      {id:"batch",title:"逐项处理",position,config:{kind:"batch",maxItems:5,batchSize:2,operations:[{kind:"template",template:"{{index}}: {{text}}"}]}},
      {id:"output",title:"输出",position,config:{kind:"deliver"}},
    ],edges:[{id:"a",source:"source",target:"split"},{id:"b",source:"split",target:"batch"},{id:"c",source:"batch",target:"output"}]};
    const draft=await service.create(user,canvas,graph,randomUUID()),run=await service.run(user,canvas,draft.id,1,randomUUID(),session);
    const execute=async(input:Parameters<typeof executeLogicNode>[0])=>await executeLogicNode(input)??{summary:"done"};
    const first=new GoalStepWorker(db,execute);for(let i=0;i<3;i++)await first.tick();
    expect((await db.query("select state,output from agent_goal_steps where goal_id=$1 and step_id='batch'",[run.goalId])).rows[0]).toMatchObject({state:"waiting_desktop",output:{processed:2,total:5}});
    first.stop();const resumed=new GoalStepWorker(db,execute);for(let i=0;i<5;i++)await resumed.tick();
    expect((await db.query("select output,attempt from agent_goal_steps where goal_id=$1 and step_id='batch'",[run.goalId])).rows[0]).toMatchObject({attempt:1,output:{items:["1: a","2: b","3: c","4: d","5: e"],processed:5}});
    expect((await db.query("select status from agent_goals where id=$1",[run.goalId])).rows[0].status).toBe("completed");
  });
  it("reuses a successful pinned generation receipt and rejects edits and unavailable assets",async()=>{
    const graph:WorkflowGraph={title:"固定结果",nodes:[{id:"source",title:"资料",position:{x:0,y:0},config:{kind:"text",role:"prompt",text:"one"}},{id:"generated",title:"已生成图片",position:{x:400,y:0},config:{kind:"generate",mediaType:"image",model:"fixture",prompt:"one",aspectRatio:"16:9",duration:5,resolution:"720p"}},{id:"output",title:"输出",position:{x:800,y:0},config:{kind:"deliver"}}],edges:[{id:"a",source:"source",target:"generated"},{id:"b",source:"generated",target:"output"}]};
    const draft=await service.create(user,canvas,graph,randomUUID()),first=await service.run(user,canvas,draft.id,1,randomUUID(),session);const generate=vi.fn();
    const worker=new GoalStepWorker(db,async input=>{if(input.step.executor==="media.generate"){generate();return {text:"verified output"};}return {summary:"ok"};});for(let i=0;i<4;i++)await worker.tick();expect(generate).toHaveBeenCalledOnce();
    graph.nodes[1]!.pin={goalId:first.goalId,nodeId:"generated"};const saved=await service.save(user,canvas,draft.id,1,graph);const second=await service.run(user,canvas,draft.id,saved.revision,randomUUID(),session);
    const executor=new GoalStepWorker(db,async input=>await executeCreativeNode(db,input)??{summary:"reused"});for(let i=0;i<3;i++)await executor.tick();
    const steps=(await db.query("select executor,output from agent_goal_steps where goal_id=$1 order by ordinal",[second.goalId])).rows;expect(steps.map(step=>step.executor)).toEqual(["result.pinned","result.deliver"]);expect(steps[0].output).toMatchObject({text:"verified output",pinned:true});expect(generate).toHaveBeenCalledOnce();
    await expect(readPinnedOutput(db,{...graph.nodes[1]!,config:{...graph.nodes[1]!.config,prompt:"changed"} as never},{workflowId:draft.id,workspaceId:workspace,userId:user})).rejects.toThrow("参数已改变");
    await db.query("update agent_goal_steps set output=$2::jsonb where goal_id=$1 and step_id='generated'",[first.goalId,JSON.stringify({assets:[{id:randomUUID(),mediaType:"image"}]})]);
    await expect(service.run(user,canvas,draft.id,saved.revision,randomUUID(),session)).rejects.toThrow("固定素材已到期");
  });
});
