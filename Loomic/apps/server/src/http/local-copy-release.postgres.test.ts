import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createPrivateVideoFixture } from "../local-db/private-video-fixture.js";

it.skipIf(!process.env.HELT_TEST_DATABASE_URL)("requires the owner, confirmation and matching file proof, then releases once", async () => {
  const f = await createPrivateVideoFixture(process.env.HELT_TEST_DATABASE_URL!);
  try {
    const id = randomUUID(), path = `${f.workspaceId}/${id}.png`, bytes = Buffer.from("locally verified picture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(join(f.root, "private-try-on", f.workspaceId), { recursive: true });
    await writeFile(join(f.root, "private-try-on", path), bytes);
    await f.db.query("insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,byte_size) values($1,$2,$3,'private-try-on',$4,'image/png',$5)", [id, f.workspaceId, f.userId, path, bytes.length]);
    await f.db.query("insert into generated_assets(workspace_id,created_by,media_type,object_path,mime_type,title) values($1,$2,'image',$3,'image/png','release fixture')", [f.workspaceId, f.userId, path]);
    const url = `/api/uploads/${id}/release-local-copy`, headers = { authorization: `Bearer ${f.token}` };
    const payload = { bytes: bytes.length, sha256, confirmation: "release-cloud-copy" };
    expect((await f.app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
    expect((await f.app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${f.colleagueToken}` } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: "POST", url, payload: { ...payload, confirmation: undefined }, headers })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url, payload: { ...payload, sha256: "0".repeat(64) }, headers })).statusCode).toBe(409);
    expect((await stat(join(f.root, "private-try-on", path))).size).toBe(bytes.length);
    const released = await f.app.inject({ method: "POST", url, payload, headers });
    expect(released.statusCode).toBe(200);
    expect(released.json().data).toMatchObject({ state: "released", bytes: bytes.length });
    await expect(stat(join(f.root, "private-try-on", path))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await f.app.inject({ url: `/api/uploads/${id}/file`, headers })).statusCode).toBe(404);
    expect((await f.app.inject({ method: "POST", url, payload, headers })).json().data.state).toBe("released");
    expect((await f.db.query("select retention_state from generated_assets where object_path=$1", [path])).rows[0].retention_state).toBe("purged");
    expect(Number((await f.db.query("select count(*) from notifications where type='asset_cloud_released'")).rows[0].count)).toBe(1);
    await f.db.query("delete from notifications where type='asset_cloud_released'");
    expect((await f.app.inject({ method: "POST", url, payload, headers })).json().data.state).toBe("released");
  } finally { await f.close(); }
});
