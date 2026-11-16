import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { registerProjectContextRoutes } from "../../http/project-context.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("project context isolation and recovery", () => {
  it("restores the last view across clients, rejects mixed identities and preserves concurrent navigation", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (url.hostname !== "127.0.0.1") throw new Error("Local PostgreSQL required");
    const admin = new Pool({ connectionString: url.href });
    const schema = `project_context_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema},public` });
    const app = Fastify();
    try {
      await db.query(await readFile(new URL("../../local-db/schema.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261020000000_website_capture.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261020000002_website_capture_assistant.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261022000000_desktop_agent_tasks.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261030000000_agent_goals.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261110000001_project_context.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261113000000_project_fitting_view.sql", import.meta.url), "utf8"));
      const user = randomUUID(), peer = randomUUID(), project = randomUUID(), other = randomUUID(), canvas = randomUUID(), otherCanvas = randomUUID(), session = randomUUID(), workspace = randomUUID();
      await db.query("insert into app_users(id,email) values($1,'owner@test.invalid'),($2,'peer@test.invalid')", [user,peer]);
      await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'studio')", [workspace,user]);
      await db.query("insert into projects(id,workspace_id,created_by,name,slug) values($1,$3,$4,'工程一','first'),($2,$3,$4,'工程二','second')", [project,other,workspace,user]);
      await db.query("insert into canvases(id,project_id,name,is_primary) values($1,$2,'画布一',true),($3,$4,'画布二',true)", [canvas,project,otherCanvas,other]);
      await db.query("insert into chat_sessions(id,canvas_id,created_by,thread_id,title) values($1,$2,$3,'thread','网站介绍')", [session,canvas,user]);
      registerProjectContextRoutes(app, { db, auth: { authenticate: async req => req.headers.authorization ? { id: req.headers.authorization } as never : null } });
      const get = (query = "", owner = user) => app.inject({ url: `/api/project-context${query}`, headers: { authorization: owner } });
      expect((await app.inject("/api/project-context")).statusCode).toBe(401);
      expect((await get()).json().data).toBeNull();
      const initial = await get(`?canvasId=${canvas}`);
      expect(initial.statusCode, initial.body).toBe(200);
      const context = initial.json().data;
      expect(context.project.id).toBe(project);
      expect(context.session.id).toBe(session);
      const save = (view: string, expectedRevision = 0) => app.inject({ method: "PUT", url: "/api/project-context", headers: { authorization: user }, payload: { projectId: project, canvasId: canvas, sessionId: session, view, compositionId: "网站开场", expectedRevision } });
      const writes = await Promise.all([save("video"), save("workflow")]);
      expect(writes.map(reply => reply.statusCode).sort()).toEqual([200,409]);
      const winner = writes.find(reply => reply.statusCode === 200)!.json().data;
      expect((await get()).json().data).toEqual(winner);
      expect((await get("",peer)).json().data).toBeNull();
      expect((await get(`?projectId=${project}`,peer)).statusCode).toBe(404);
      expect((await get(`?projectId=${other}&canvasId=${canvas}`)).statusCode).toBe(404);
      expect((await get(`?projectId=${other}&sessionId=${session}`)).statusCode).toBe(404);
      expect((await get("?projectId=invalid")).statusCode).toBe(400);
      expect((await save("timeline", winner.revision)).statusCode).toBe(200);
      expect((await get()).json().data.view).toBe("timeline");
      const fitting = await save("fitting", (await get()).json().data.revision);
      expect(fitting.statusCode).toBe(200);
      expect(fitting.json().data.view).toBe("fitting");
      const localGoal = randomUUID(), globalGoal = randomUUID();
      await db.query(`insert into agent_goals(id,workspace_id,created_by,canvas_id,goal,status,idempotency_key)
        values($1::uuid,$3,$4,$5,'继续本画布剪辑','running',($1::uuid)::text),($2::uuid,$3,$4,null,'工作区待办','running',($2::uuid)::text)`,
        [localGoal, globalGoal, workspace, user, canvas]);
      const next = await get(`?canvasId=${canvas}`);
      expect(next.statusCode, next.body).toBe(200);
      expect(next.json().data.nextStep.goalId).toBe(localGoal);
      expect((await get(`?canvasId=${otherCanvas}`)).json().data.nextStep.goalId).toBe(globalGoal);
      await db.query("update projects set archived_at=now() where id=$1", [project]);
      expect((await get(`?projectId=${project}`)).statusCode).toBe(404);
      expect((await get()).json().data).toBeNull();
    } finally {
      await app.close(); await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
    }
  });
});
