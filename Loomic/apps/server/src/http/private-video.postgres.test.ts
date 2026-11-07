import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import sharp from "sharp";
import { createPrivateVideoFixture } from "../local-db/private-video-fixture.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const exportPath = process.env.HELT_TEST_VIDEO_FILE;

it.skipIf(!databaseUrl || !exportPath)("persists a real export once across retries, authenticates reads and delivers one chat result", async () => {
  const fixture = await createPrivateVideoFixture(databaseUrl!);
  try {
    const bytes = await readFile(exportPath!);
    const payload = Buffer.concat([
      Buffer.from('--test-video\r\nContent-Disposition: form-data; name="file"; filename="render.mp4"\r\nContent-Type: video/mp4\r\n\r\n'),
      bytes, Buffer.from("\r\n--test-video--\r\n"),
    ]);
    const headers = { authorization: `Bearer ${fixture.token}`, "content-type": "multipart/form-data; boundary=test-video", "idempotency-key": randomUUID() };
    const upload = () => fixture.app.inject({ method: "POST", url: "/api/assets/private-video", headers, payload });
    const pair = await Promise.all([upload(), upload()]);
    expect(pair.map(response => response.statusCode).sort()).toEqual([200, 201]);
    const assetId = pair[0].json().assetId;
    expect(pair[1].json().assetId).toBe(assetId);
    // Simulate a client losing the successful response and resending its persisted key.
    expect((await upload()).json()).toMatchObject({ assetId, created: false });
    const rows = (await fixture.db.query("select * from asset_objects")).rows;
    expect(rows).toHaveLength(1);
    expect((await fixture.db.query("select title from generated_assets")).rows[0].title).toBe("render.mp4");
    await fixture.db.query("update generated_assets set title='Video export'");
    expect((await upload()).json()).toMatchObject({assetId,created:false});
    expect((await fixture.db.query("select title from generated_assets")).rows[0].title).toBe("render.mp4");
    expect(rows[0].bucket).toBe("private-video");
    expect(await readFile(join(fixture.root, rows[0].bucket, rows[0].object_path))).toEqual(bytes);
    const path = `/api/uploads/${assetId}/file`;
    expect((await fixture.app.inject(path)).statusCode).toBe(401);
    const authorized = { authorization: headers.authorization };
    const playback = await fixture.app.inject({ url: path, headers: { ...authorized, range: "bytes=0-31" } });
    expect(playback.statusCode).toBe(206);
    expect(playback.rawPayload).toEqual(bytes.subarray(0, 32));
    expect(playback.headers["cache-control"]).toBe("private, no-store");
    const deliver = () => fixture.app.inject({ method: "POST", url: `/api/assets/private-video/${assetId}/send-to-chat`, headers: authorized, payload: { sessionId: fixture.sessionId } });
    const deliveries = await Promise.all([deliver(), deliver()]);
    expect(deliveries.map(reply => reply.statusCode)).toEqual([200, 200]);
    expect(deliveries[0].json().messageId).toBe(deliveries[1].json().messageId);
    expect(Number((await fixture.db.query("select count(*) from chat_messages")).rows[0].count)).toBe(1);
    await fixture.db.query("delete from workspace_members where user_id=$1", [fixture.userId]);
    expect((await fixture.app.inject({ url: path, headers: authorized })).statusCode).toBe(404);
    expect((await deliver()).statusCode).toBe(404);
  } finally { await fixture.close(); }
}, 60_000);

it.skipIf(!databaseUrl)("persists a private try-on once and rejects cross-user, expired and deleted results", async () => {
  const fixture = await createPrivateVideoFixture(databaseUrl!);
  try {
    const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: "#735a91" } }).webp().toBuffer();
    const body = (image: Buffer) => Buffer.concat([
      Buffer.from('--try-on\r\nContent-Disposition: form-data; name="file"; filename="try-on.webp"\r\nContent-Type: image/webp\r\n\r\n'),
      image, Buffer.from("\r\n--try-on--\r\n"),
    ]);
    const headers = { authorization: `Bearer ${fixture.token}`, "content-type": "multipart/form-data; boundary=try-on", "idempotency-key": randomUUID() };
    const upload = (image = bytes) => fixture.app.inject({ method: "POST", url: "/api/assets/private-try-on", headers, payload: body(image) });
    const replies = await Promise.all([upload(), upload()]);
    expect(replies.map(reply => reply.statusCode).sort()).toEqual([200, 201]);
    const assetId = replies[0].json().assetId;
    expect(replies[1].json().assetId).toBe(assetId);
    expect((await upload()).json()).toMatchObject({ assetId, created: false });
    expect((await upload(Buffer.from("invalid image"))).statusCode).toBe(400);
    const path = `/api/uploads/${assetId}/file`;
    const owner = { authorization: headers.authorization };
    const colleague = { authorization: `Bearer ${fixture.colleagueToken}` };
    const image = await fixture.app.inject({ url: path, headers: owner });
    expect(image.rawPayload).toEqual(bytes);
    expect(image.headers["cache-control"]).toBe("private, no-store");
    expect((await fixture.app.inject({ url: path, headers: colleague })).statusCode).toBe(404);
    const deliver = (auth = owner) => fixture.app.inject({ method: "POST", url: `/api/assets/private-try-on/${assetId}/send-to-chat`, headers: auth, payload: { sessionId: fixture.sessionId } });
    expect((await deliver(colleague)).statusCode).toBe(404);
    const messages = await Promise.all([deliver(), deliver()]);
    expect(messages.map(reply => reply.statusCode)).toEqual([200, 200]);
    expect(messages[0].json().messageId).toBe(messages[1].json().messageId);
    const saved = (await fixture.db.query("select * from chat_messages")).rows;
    expect(saved).toHaveLength(1);
    expect(saved[0].content_blocks[0].toolName).toBe("fashion_try_on");
    await fixture.db.query("update generated_assets set retention_until=now()-interval '1 second'");
    expect((await fixture.app.inject({ url: path, headers: owner })).statusCode).toBe(404);
    expect((await deliver()).statusCode).toBe(404);
    expect((await upload()).statusCode).toBe(409);
    await fixture.db.query("update generated_assets set retention_until=now()+interval '1 day',deleted_at=now()");
    expect((await fixture.app.inject({ url: path, headers: owner })).statusCode).toBe(404);
    expect((await deliver()).statusCode).toBe(404);
    expect(Number((await fixture.db.query("select count(*) from asset_objects")).rows[0].count)).toBe(1);
  } finally { await fixture.close(); }
}, 60_000);
