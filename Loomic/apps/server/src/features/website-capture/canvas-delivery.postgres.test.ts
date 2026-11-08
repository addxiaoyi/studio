import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StorageProvider } from "../../storage/storage-provider.js";
import { deliverCaptureToCanvas } from "./canvas-delivery.js";

const connectionString = process.env.HELT_TEST_DATABASE_URL;
const schema = `capture_canvas_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString });
const db = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const storage = { download: async () => ({ data: Buffer.from("screenshot"), error: null }) } as unknown as StorageProvider;

describe.skipIf(!connectionString)("website capture canvas delivery", () => {
  beforeAll(async () => {
    await admin.query(`create schema ${schema}`);
    await db.query(`
      create table canvases(id uuid primary key,project_id uuid,content jsonb,version integer default 1,updated_at timestamptz default now());
      create table projects(id uuid primary key,workspace_id uuid);
      create table workspace_members(workspace_id uuid,user_id uuid);
      create table chat_sessions(id uuid primary key,canvas_id uuid,created_by uuid);
      create table website_capture_tasks(id uuid primary key,result jsonb,created_by uuid,workspace_id uuid,session_id uuid,status text,updated_at timestamptz default now());
      create table asset_objects(id uuid primary key,bucket text,object_path text,mime_type text,created_by uuid,workspace_id uuid);
      create table generated_assets(workspace_id uuid,object_path text,website_capture_task_id uuid,metadata jsonb default '{}',deleted_at timestamptz,retention_state text default 'active',retention_until timestamptz default now()+interval '3 days');
    `);
  });
  afterAll(async () => { await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); });

  async function fixture() {
    const owner = randomUUID(), workspace = randomUUID(), project = randomUUID(), canvas = randomUUID();
    const session = randomUUID(), task = randomUUID(), image = randomUUID(), video = randomUUID();
    await db.query("insert into projects values($1,$2)", [project, workspace]);
    await db.query("insert into workspace_members values($1,$2)", [workspace, owner]);
    await db.query("insert into canvases(id,project_id,content) values($1,$2,$3)", [canvas, project, JSON.stringify({ elements: [{ id: "user-note", type: "text", text: "Keep me" }], appState: {}, files: {} })]);
    await db.query("insert into chat_sessions values($1,$2,$3)", [session, canvas, owner]);
    const result = { title: "Example", introduction: "## Example", pages: [{ assetId: image, title: "Home" }], recordingAssetId: video, recordingDurationSeconds: 12 };
    await db.query("insert into website_capture_tasks(id,result,created_by,workspace_id,session_id,status) values($1,$2,$3,$4,$5,'succeeded')", [task, JSON.stringify(result), owner, workspace, session]);
    for (const [id, mime] of [[image, "image/jpeg"], [video, "video/webm"]]) {
      await db.query("insert into asset_objects values($1,'project-assets',$2,$3,$4,$5)", [id, `${task}/${id}`, mime, owner, workspace]);
      await db.query("insert into generated_assets(workspace_id,object_path,website_capture_task_id) values($1,$2,$3)", [workspace, `${task}/${id}`, task]);
    }
    return { owner, workspace, canvas, task, image, video };
  }

  it("adds private screenshots and video once under concurrent delivery and keeps manual edits", async () => {
    const f = await fixture();
    const receipts = await Promise.all(Array.from({ length: 4 }, () => deliverCaptureToCanvas(db, storage, f.task, f.owner)));
    expect(receipts.every(receipt => receipt.status === "succeeded")).toBe(true);
    const canvas = (await db.query("select content,version from canvases where id=$1", [f.canvas])).rows[0];
    expect(canvas.content.elements).toHaveLength(3);
    expect(canvas.content.elements[0].text).toBe("Keep me");
    expect(canvas.version).toBe(2);
    expect(canvas.content.elements[2].link).toBe(`/api/uploads/${f.video}/file`);
    expect(canvas.content.elements[2].customData).toMatchObject({ assetId: f.video, durationSeconds: 12, websiteCaptureTaskId: f.task, timelineIncluded: false });
    expect(Object.keys(canvas.content.files)).toHaveLength(1);
  });
  it("rejects another owner and revoked workspace access", async () => {
    const f = await fixture();
    await expect(deliverCaptureToCanvas(db, storage, f.task, randomUUID())).rejects.toThrow("无权访问");
    await db.query("delete from workspace_members where workspace_id=$1", [f.workspace]);
    await expect(deliverCaptureToCanvas(db, storage, f.task, f.owner)).rejects.toThrow("无权访问");
  });
  it("does not partly insert when one asset is deleted or expired", async () => {
    const f = await fixture();
    await db.query("update generated_assets set retention_until=now()-interval '1 second' where object_path=$1", [`${f.task}/${f.video}`]);
    await expect(deliverCaptureToCanvas(db, storage, f.task, f.owner)).rejects.toThrow("到期");
    expect((await db.query("select content from canvases where id=$1", [f.canvas])).rows[0].content.elements).toHaveLength(1);
  });
  it("does not recreate assets removed by the user after successful delivery", async () => {
    const f = await fixture();
    await deliverCaptureToCanvas(db, storage, f.task, f.owner);
    await db.query("update canvases set content=jsonb_set(content,'{elements}','[]') where id=$1", [f.canvas]);
    await deliverCaptureToCanvas(db, storage, f.task, f.owner);
    expect((await db.query("select content from canvases where id=$1", [f.canvas])).rows[0].content.elements).toHaveLength(0);
  });
});
