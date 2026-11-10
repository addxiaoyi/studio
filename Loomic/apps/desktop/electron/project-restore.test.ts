import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { ProjectRestore } from "./project-restore.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("previews without writes, restores local media on confirmation and deduplicates a repeat", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-restore-"))); roots.push(root);
  const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
  const account = randomUUID(), asset = randomUUID(), replacement = randomUUID();
  const folder = join(root, "Media", account); await mkdir(folder); const file = join(folder, "saved.png"); await writeFile(file, "private-image");
  await mkdir(join(root, "Projects", account));
  await writeFile(join(root, "Projects", account, "backup-index.json"), JSON.stringify({ account, items: [{ key: `asset:${asset}`, receipt: { path: file, bytes: 13, sha256: createHash("sha256").update("private-image").digest("hex"), savedAt: new Date().toISOString() } }] }));
  const snapshot = { format: "helstera-project-backup", formatVersion: 1, project: { id: randomUUID(), name: "恢复工程", workspace: { ownerUserId: account } }, canvas: { id: randomUUID(), content: { elements: [{ id: "image", link: `/api/uploads/${asset}/file` }] } }, sessions: [] };
  const path = join(root, "snapshot.json"); await writeFile(path, JSON.stringify(snapshot));
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith("/api/viewer")) return Response.json({ profile: { id: account } });
    if (options?.method === "HEAD") return new Response(null, { status: 404 });
    if (String(url).endsWith("private-try-on")) {
      expect(options?.body).toBeInstanceOf(FormData);
      const blob = (options!.body as FormData).get("file") as Blob; expect(await blob.text()).toBe("private-image");
      return Response.json({ ok: true, assetId: replacement });
    }
    expect(JSON.parse(String(options?.body)).replacements).toEqual({ [asset]: replacement });
    return Response.json({ ok: true, data: { projectId: randomUUID(), canvasId: randomUUID(), sessionId: null, restored: true } });
  });
  const restore = new ProjectRestore({ setup, origin: () => "https://studio.test", request: request as typeof fetch });
  const credentials = { accountId: account, accessToken: "private-token" };
  const preview = await restore.inspect(path, credentials);
  expect(preview).toMatchObject({ localMedia: 1, uploadBytes: 13, missingMedia: 0 });
  expect(request.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  const restored = await restore.apply(preview.id, credentials);
  expect(await restore.apply(preview.id, credentials)).toEqual(restored);
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/restore"))).toHaveLength(1);
  expect(await readFile(file, "utf8")).toBe("private-image");
  const fresh = await restore.inspect(path, credentials); await writeFile(path, JSON.stringify({ ...snapshot, project: { ...snapshot.project, name: "changed" } }));
  await expect(restore.apply(fresh.id, credentials)).rejects.toThrow("已改变");
});

it("reuses available private media without uploading and blocks uncertain availability", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-reuse-"))); roots.push(root);
  const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
  const account = randomUUID(), asset = randomUUID();
  const snapshot = { format: "helstera-project-backup", formatVersion: 1, project: { id: randomUUID(), name: "复用素材", workspace: { ownerUserId: account } }, canvas: { id: randomUUID(), content: { elements: [{ id: "image", link: `/api/uploads/${asset}/file` }] } }, sessions: [] };
  const path = join(root, "snapshot.json"); await writeFile(path, JSON.stringify(snapshot));
  let status = 200;
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith("/api/viewer")) return Response.json({ profile: { id: account } });
    if (options?.method === "HEAD") return new Response(null, { status });
    expect(String(url)).toMatch(/\/project-backups\/restore$/);
    expect(JSON.parse(String(options?.body)).replacements).toEqual({});
    return Response.json({ ok: true, data: { projectId: randomUUID(), canvasId: randomUUID(), sessionId: null, restored: true } });
  });
  const restore = new ProjectRestore({ setup, origin: () => "https://studio.test", request: request as typeof fetch });
  const credentials = { accountId: account, accessToken: "test-token" };
  const preview = await restore.inspect(path, credentials);
  expect(preview).toMatchObject({ reusedMedia: 1, localMedia: 0, uploadBytes: 0, missingMedia: 0 });
  await restore.apply(preview.id, credentials);
  expect(request.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  status = 502;
  await expect(restore.inspect(path, credentials)).rejects.toThrow("素材状态检查失败（502）");
});
