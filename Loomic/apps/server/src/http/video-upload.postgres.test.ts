import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createPrivateVideoFixture } from "../local-db/private-video-fixture.js";
import { VideoUploads } from "../features/assets/video-upload.js";
import { createLocalStorageProvider } from "../storage/local-storage-provider.js";
const databaseUrl = process.env.HELT_TEST_DATABASE_URL;

it.skipIf(!databaseUrl)("resumes verified chunks across service restarts and commits one private asset", async () => {
  const f = await createPrivateVideoFixture(databaseUrl!);
  try {
    const bytes = Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypisom"),Buffer.alloc(128 * 1024, 7)]);
    const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    const id = randomUUID(), url = `/api/assets/private-video/uploads/${id}`, headers = { authorization: `Bearer ${f.token}` };
    const metadata = { bytes: bytes.length, sha256: digest(bytes), mimeType: "video/mp4", filename: "large.mp4" };
    const begin = () => f.app.inject({ method: "PUT", url, headers, payload: metadata });
    const chunk = bytes.subarray(0, 65536);
    const append = (offset: number, content = chunk, checksum = digest(content)) => f.app.inject({ method: "PATCH", url, headers: { ...headers, "content-type": "application/octet-stream", "upload-offset": String(offset), "upload-checksum": checksum }, payload: content });
    expect((await f.app.inject({ method: "PUT", url, payload: metadata })).statusCode).toBe(401);
    expect((await begin()).json().data.offset).toBe(0);
    expect((await append(0, chunk, "0".repeat(64))).statusCode).toBe(400);
    expect((await append(0)).json().data.offset).toBe(chunk.length);
    const listed = await f.app.inject({ url: "/api/assets/private-video/uploads", headers });
    expect(listed.json().data).toEqual([expect.objectContaining({ uploadId: id, offset: chunk.length, storedBytes: chunk.length })]);
    expect((await f.app.inject({ url: "/api/assets/private-video/uploads", headers: { authorization: `Bearer ${f.colleagueToken}` } })).json().data).toEqual([]);
    expect((await append(0)).json().data.offset).toBe(chunk.length);
    expect((await append(0, Buffer.alloc(chunk.length))).statusCode).toBe(409);
    expect((await f.app.inject({ method: "POST", url, headers })).statusCode).toBe(409);
    const intruder = await f.app.inject({ method: "POST", url, headers: { authorization: `Bearer ${f.colleagueToken}` } });
    expect(intruder.statusCode).toBe(404);
    expect(await readdir(`${f.root}.video-uploads`)).toHaveLength(1);
    expect((await f.app.inject({ method: "DELETE", url: `/api/assets/private-video/uploads/${randomUUID()}`, headers })).statusCode).toBe(200);
    expect(await readdir(`${f.root}.video-uploads`)).toHaveLength(1);
    const restarted = new VideoUploads(f.db, createLocalStorageProvider({ rootDir: f.root }), `${f.root}.video-uploads`);
    expect((await restarted.begin({ userId: f.userId, workspaceId: f.workspaceId }, id, metadata as never)).offset).toBe(chunk.length);
    expect((await append(chunk.length, bytes.subarray(chunk.length))).json().data.offset).toBe(bytes.length);
    const complete = await f.app.inject({ method: "POST", url, headers });
    expect(complete.statusCode).toBe(200);
    const asset = complete.json().data.assetId;
    expect((await f.app.inject({ method: "POST", url, headers })).json().data.assetId).toBe(asset);
    expect((await begin()).json().data.assetId).toBe(asset);
    expect((await f.app.inject({ url: `/api/uploads/${asset}/file`, headers })).rawPayload).toEqual(bytes);
    expect((await f.app.inject({ url: `/api/uploads/${asset}/file`, headers: { authorization: `Bearer ${f.colleagueToken}` } })).statusCode).toBe(404);
    expect(Number((await f.db.query("select count(*) from asset_objects")).rows[0].count)).toBe(1);
    const sameContent = await f.app.inject({ method: "PUT", url: `/api/assets/private-video/uploads/${randomUUID()}`, headers, payload: metadata });
    expect(sameContent.json().data).toMatchObject({ assetId: asset, offset: bytes.length });
    expect((await f.app.inject({ url: "/api/assets/private-video/uploads", headers })).json().data).toEqual([]);
    expect((await f.app.inject({ method: "DELETE", url, headers })).statusCode).toBe(200);
    expect((await f.app.inject({ url: `/api/uploads/${asset}/file`, headers })).statusCode).toBe(200);
    const path = (await f.db.query("select object_path from asset_objects where id=$1", [asset])).rows[0].object_path;
    await createLocalStorageProvider({ rootDir: f.root }).remove("private-video", [path]);
    const missingFile = await f.app.inject({ method: "PUT", url: `/api/assets/private-video/uploads/${randomUUID()}`, headers, payload: metadata });
    expect(missingFile.json().data).toMatchObject({ assetId: null, offset: 0 });
  } finally { await f.close(); }
}, 30000);

it.skipIf(!databaseUrl)("refuses changed metadata, incomplete or corrupt files, and clears expired parts", async () => {
  const f = await createPrivateVideoFixture(databaseUrl!);
  try {
    const id = randomUUID(), uploads = new VideoUploads(f.db, createLocalStorageProvider({ rootDir: f.root }), `${f.root}.video-uploads`);
    const owner = { userId: f.userId, workspaceId: f.workspaceId }, bytes = Buffer.from("0000ftypisom-corrupt-video");
    const metadata = { bytes: bytes.length, sha256: "0".repeat(64), mimeType: "video/mp4" as const, filename: "large.mp4" };
    await uploads.begin(owner, id, metadata);
    await expect(uploads.begin(owner, id, { ...metadata, bytes: bytes.length + 1 })).rejects.toThrow("已改变");
    await uploads.append(owner, id, 0, createHash("sha256").update(bytes).digest("hex"), bytes);
    await expect(uploads.complete(owner, id)).rejects.toThrow("校验失败");
    expect(Number((await f.db.query("select count(*) from asset_objects")).rows[0].count)).toBe(0);
    const folder = join(`${f.root}.video-uploads`, (await readdir(`${f.root}.video-uploads`))[0]!);
    const state = JSON.parse(await readFile(join(folder, "state.json"), "utf8"));
    await writeFile(join(folder, "state.json"), JSON.stringify({ ...state, expiresAt: Date.now() - 1 }));
    await uploads.cleanup();
    expect(await readdir(`${f.root}.video-uploads`)).toEqual([]);
  } finally { await f.close(); }
}, 30000);
