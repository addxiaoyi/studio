import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { executableGoalPlan } from "./goal-planner.js";
import { initializeGoalSteps, decideGoalStep, reviewGoalStep } from "./goal-step-store.js";
import { GoalStepWorker } from "./goal-step-worker.js";
import { createGoalStepExecutor } from "./goal-step-executors.js";
import { createLocalStorageProvider } from "../../storage/local-storage-provider.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("goal execution journal", () => {
  it("requires confirmation and exact approval, resumes completed steps, and fences uncertain effects", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Local PostgreSQL required.");
    const admin = new Pool({ connectionString: url.href });
    const schema = `goal_steps_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    try {
      await db.query(await readFile(new URL("../../local-db/schema.sql", import.meta.url), "utf8"));
      for (const migration of ["20261020000000_website_capture", "20261020000001_website_capture_job_link", "20261020000002_website_capture_assistant", "20261022000000_desktop_agent_tasks", "20261022000001_website_capture_asset_links", "20261030000000_agent_goals", "20261030000001_agent_goal_retry", "20261030000002_agent_goal_background", "20261031000000_agent_muse_workspace", "20261106000003_goal_execution_steps", "20261110000000_media_resource_leases"]) {
        await db.query(await readFile(new URL(`../../local-db/migrations/${migration}.sql`, import.meta.url), "utf8"));
      }
      const userId = randomUUID(), workspaceId = randomUUID(), goalId = randomUUID();
      await db.query("insert into app_users(id,email) values($1,'goal@test.invalid')", [userId]);
      await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'goals')", [workspaceId,userId]);
      const plan = executableGoalPlan({ summary: "研究并录制", steps: [
        { id: "search", title: "检索主题", dependsOn: [], command: { executor: "web.search", query: "Loomic" }, completion: "获得公开网址" },
        { id: "record", title: "录制网址", dependsOn: ["search"], command: { executor: "web.capture", fromStep: "search", pageLimit: 1, record: true }, completion: "保存WebM" },
        { id: "deliver", title: "交付结果", dependsOn: ["record"], command: { executor: "result.deliver", sources: ["record"] }, completion: "保存结果" },
      ] }, { goal: "研究并录制", executionMode: "automatic", idempotencyKey: "test" });
      await db.query("insert into agent_goals(id,workspace_id,created_by,goal,plan,idempotency_key,status) values($1,$2,$3,'研究并录制',$4::jsonb,'test','draft')", [goalId,workspaceId,userId,JSON.stringify(plan)]);
      await initializeGoalSteps(db, goalId, plan);
      const execute = vi.fn(async ({ step }: Parameters<ConstructorParameters<typeof GoalStepWorker>[1]>[0]) => step.executor === "web.search" ? { url: "https://example.com/" } : { summary: "完成", evidence: "verified", assets: [] });
      const first = new GoalStepWorker(db,execute), second = new GoalStepWorker(db,execute);
      await first.tick(); expect(execute).not.toHaveBeenCalled();
      await db.query("update agent_goals set status='running',confirmed_at=now() where id=$1", [goalId]);
      await Promise.all([first.tick(),second.tick()]);
      expect(execute).toHaveBeenCalledTimes(1);
      await first.tick();
      let step = (await db.query("select * from agent_goal_steps where goal_id=$1 and step_id='record'", [goalId])).rows[0];
      expect(step.state).toBe("waiting_approval"); expect(step.command.url).toBe("https://example.com/");
      await expect(decideGoalStep(db,userId,workspaceId,goalId,step.id,"0".repeat(64),"approve")).rejects.toThrow();
      await db.query("update agent_goal_steps set approval_expires_at=now()-interval '1 second' where id=$1", [step.id]);
      await expect(decideGoalStep(db,userId,workspaceId,goalId,step.id,step.fingerprint,"approve")).rejects.toThrow();
      await second.tick();
      await decideGoalStep(db,userId,workspaceId,goalId,step.id,step.fingerprint,"approve");
      await db.query("update agent_goal_steps set state='running',approval='consumed',lease_token=$2,lease_until=now()-interval '1 second' where id=$1", [step.id,randomUUID()]);
      await first.tick();
      expect(execute).toHaveBeenCalledTimes(1);
      expect((await db.query("select state from agent_goal_steps where id=$1", [step.id])).rows[0].state).toBe("review");
      await reviewGoalStep(db,userId,workspaceId,goalId,step.id,"observed_not_completed");
      await first.tick();
      step = (await db.query("select * from agent_goal_steps where id=$1", [step.id])).rows[0];
      await decideGoalStep(db,userId,workspaceId,goalId,step.id,step.fingerprint,"approve");
      await Promise.all([first.tick(),second.tick()]);
      expect(execute).toHaveBeenCalledTimes(2);
      await new GoalStepWorker(db,execute).tick();
      expect(execute).toHaveBeenCalledTimes(3);
      expect((await db.query("select status from agent_goals where id=$1", [goalId])).rows[0].status).toBe("completed");
      expect((await db.query("select state from agent_goal_steps where goal_id=$1", [goalId])).rows.every(row=>row.state==='succeeded')).toBe(true);
      await first.tick(); expect(execute).toHaveBeenCalledTimes(3);
      const rejectedId=randomUUID();
      const rejectedPlan=executableGoalPlan({summary:'拒绝验收',steps:[
        {id:'record',title:'录制',dependsOn:[],command:{executor:'web.capture',url:'https://example.com/',record:true,pageLimit:1},completion:'WebM'},
        {id:'deliver',title:'交付',dependsOn:['record'],command:{executor:'result.deliver',sources:['record']},completion:'保存'},
      ]},{goal:'拒绝验收',idempotencyKey:rejectedId,executionMode:'automatic'});
      await db.query("insert into agent_goals(id,workspace_id,created_by,goal,plan,idempotency_key,status,confirmed_at) values($1,$2,$3,'拒绝验收',$4::jsonb,$5,'running',now())",[rejectedId,workspaceId,userId,JSON.stringify(rejectedPlan),rejectedId]);
      await initializeGoalSteps(db,rejectedId,rejectedPlan);await first.tick();
      const refused=(await db.query("select * from agent_goal_steps where goal_id=$1 and step_id='record'",[rejectedId])).rows[0];
      await decideGoalStep(db,userId,workspaceId,rejectedId,refused.id,refused.fingerprint,'reject');
      await first.tick();expect(execute).toHaveBeenCalledTimes(3);
      expect((await db.query('select status from agent_goals where id=$1',[rejectedId])).rows[0].status).toBe('canceled');
      const interruptedId = randomUUID();
      await db.query("insert into agent_goals(id,workspace_id,created_by,goal,plan,idempotency_key,status,confirmed_at) values($1,$2,$3,'退出恢复验收',$4::jsonb,$5,'running',now())", [interruptedId,workspaceId,userId,JSON.stringify(rejectedPlan),interruptedId]);
      await initializeGoalSteps(db,interruptedId,rejectedPlan);
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const interrupted = new GoalStepWorker(db, async ({ signal }) => {
        entered();
        return new Promise<Record<string, unknown>>((_, reject) => signal.addEventListener("abort", () => reject(new Error("service draining")), { once: true }));
      });
      await interrupted.tick();
      const approved = (await db.query("select * from agent_goal_steps where goal_id=$1 and step_id='record'", [interruptedId])).rows[0];
      await decideGoalStep(db,userId,workspaceId,interruptedId,approved.id,approved.fingerprint,"approve");
      const pendingStep = interrupted.tick();
      await started;
      await interrupted.stop();
      await pendingStep;
      expect((await db.query("select state,lease_token from agent_goal_steps where id=$1", [approved.id])).rows[0]).toMatchObject({ state: "review", lease_token: null });
      expect((await db.query("select status from agent_goals where id=$1", [interruptedId])).rows[0].status).toBe("paused");
      await first.tick();
      expect(execute).toHaveBeenCalledTimes(3);

      const slowId = randomUUID(), fastId = randomUUID();
      const insertIndependent = async (id: string) => {
        await db.query("insert into agent_goals(id,workspace_id,created_by,goal,plan,idempotency_key,status,confirmed_at) values($1,$2,$3,'并行调度验收',$4::jsonb,$5,'running',now())", [id,workspaceId,userId,JSON.stringify(plan),id]);
        await initializeGoalSteps(db,id,plan);
      };
      await insertIndependent(slowId);
      let finishSlow!: () => void;
      const slow = new Promise<void>(resolve => { finishSlow = resolve; });
      const calls: string[] = [];
      const parallel = new GoalStepWorker(db, async ({ goal }) => {
        calls.push(goal.id);
        if (goal.id === slowId) await slow;
        return { url: "https://example.com/" };
      });
      const slowTick = parallel.tick();
      try {
        await vi.waitFor(() => expect(calls).toContain(slowId));
        await insertIndependent(fastId);
        await parallel.tick();
        expect(calls).toContain(fastId);
      } finally {
        finishSlow();
        await slowTick;
        await parallel.stop();
        await db.query("update agent_goals set status='paused' where id=any($1::uuid[])", [[slowId,fastId]]);
      }

      if (process.env.HELT_GOAL_LIVE_CAPTURE === "1") {
        const root = await mkdtemp(join(tmpdir(), "goal-live-"));
        try {
          const realId = randomUUID();
          const realPlan = executableGoalPlan({ summary: "录制并交付", steps: [
            { id: "record", title: "录制网页", dependsOn: [], command: { executor: "web.capture", url: process.env.HELT_GOAL_CAPTURE_URL ?? "https://example.com/", pageLimit: 1, record: true }, completion: "真实WebM" },
            { id: "trim", title: "剪裁录制", dependsOn: ["record"], command: { executor: "media.trim", fromStep: "record", start: 0, end: 0.2, aspect: "original" }, completion: "真实MP4" },
            { id: "deliver", title: "交付", dependsOn: ["record","trim"], command: { executor: "result.deliver", sources: ["record","trim"] }, completion: "结果持久化" },
          ] }, { goal: "录制example.com并剪裁", idempotencyKey: realId, executionMode: "automatic" });
          await db.query("insert into agent_goals(id,workspace_id,created_by,goal,plan,idempotency_key,status,confirmed_at) values($1,$2,$3,'录制example.com',$4::jsonb,$5,'running',now())", [realId,workspaceId,userId,JSON.stringify(realPlan),realId]);
          await initializeGoalSteps(db,realId,realPlan);
          const live = new GoalStepWorker(db, createGoalStepExecutor({ db, storage: createLocalStorageProvider({rootDir:root}), storageRoot:root, webOrigin:"http://localhost:3219", desktop:{} as never }));
          for (const name of ["record","trim"]) {
            await live.tick();
            const approval = (await db.query("select * from agent_goal_steps where goal_id=$1 and step_id=$2",[realId,name])).rows[0];
            expect(approval.state).toBe("waiting_approval");
            await decideGoalStep(db,userId,workspaceId,realId,approval.id,approval.fingerprint,"approve");
            await live.tick();
            const done=(await db.query("select state,error from agent_goal_steps where id=$1",[approval.id])).rows[0];
            expect(done.state,done.error).toBe("succeeded");
          }
          await live.tick();
          const delivered=(await db.query("select status,result from agent_goals where id=$1",[realId])).rows[0];
          expect(delivered.status).toBe("completed");expect(delivered.result.assets.length).toBeGreaterThanOrEqual(3);
          const captured=(await db.query("select result from website_capture_tasks where id=(select id from agent_goal_steps where goal_id=$1 and step_id='record')",[realId])).rows[0].result;
          expect(captured.pages[0].title).not.toMatch(/error|blocked|unavailable/i);
          console.log("REAL_GOAL_CAPTURE_TRIM_PASSED", JSON.stringify({ goalId:realId,title:captured.pages[0].title, pages:captured.pages.length, assets:delivered.result.assets.length, recording:captured.recordingAssetId }));
        } finally {await rm(root,{recursive:true,force:true});}
      }
    } finally { await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
  },180_000);
});
