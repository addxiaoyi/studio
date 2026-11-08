import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { websiteWorkflow } from "@helstera/shared";
import { CanvasWorkflowService } from "./service.js";
import { GoalStepWorker } from "../agent-goals/goal-step-worker.js";
import { decideGoalStep } from "../agent-goals/goal-step-store.js";
import { createCanvasWorkflowTool } from "../../agent/tools/canvas-workflow.js";

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
});
