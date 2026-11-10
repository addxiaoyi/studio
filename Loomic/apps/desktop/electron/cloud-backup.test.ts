import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { CloudBackup } from "./cloud-backup.js";
import { DesktopSetup } from "./desktop-setup.js";
const accountId = "123e4567-e89b-42d3-a456-426614174000";
const assetId = "123e4567-e89b-42d3-a456-426614174001";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "helstera-backup-")); roots.push(root);
  const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: true, agentAccess: false });
  let broken = false;
  const request = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://studio.test");
    expect(options?.redirect).toBe("error");
    expect(options?.credentials).toBe("include");
    if (url.pathname === "/api/viewer") return Response.json({ profile: { id: accountId } });
    if (url.pathname === "/api/assets/history") return Response.json({ data: [{ id: assetId, asset_object_id: assetId, title: "私有录像", mime_type: "video/webm" }], pagination: { hasMore: false } });
    if (url.pathname === "/api/projects") return Response.json({ projects: [{ id: accountId, name: "工程", primaryCanvas: { id: accountId } }] });
    if (url.pathname.endsWith("/sessions")) return Response.json({ sessions: [{ id: accountId, title: "创作对话" }] });
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ role: "user", content: "创作需求" }] });
    if (url.pathname.startsWith("/api/canvases/")) return Response.json({ canvas: { id: accountId, content: { elements: [] } }, version: 2 });
    if (url.pathname.startsWith("/api/uploads/")) return broken ? new Response("gone", { status: 404 }) : new Response("actual-private-video", { headers: { "content-type": "video/webm" } });
    throw new Error("unexpected endpoint");
  });
  const backup = new CloudBackup({ setup, origin: () => "https://studio.test", request: request as typeof fetch, changed: vi.fn() });
  return { root, setup, backup, request, breakDownload: () => { broken = true; }, repair: () => { broken = false; } };
}
it("saves private bytes and canvas snapshots and verifies existing copies on retry", async () => {
  const { root, backup, request, setup } = await fixture();
  const state = await backup.run({ accountId, accessToken: "never-persist-this" });
  expect(state).toMatchObject({ status: "completed", completed: 2, failed: 0 });
  const video = state.items.find(item => item.key.startsWith("asset:"))!.receipt!;
  expect(await readFile(video.path, "utf8")).toBe("actual-private-video");
  const snapshot = state.items.find(item => item.key.startsWith("project:"))!.receipt!;
  expect(JSON.parse(await readFile(snapshot.path, "utf8")).canvas.content).toEqual({ elements: [] });
  expect(JSON.parse(await readFile(snapshot.path, "utf8")).sessions[0].messages[0].content).toBe("创作需求");
  const index = await readFile(join(root, "Projects", accountId, "backup-index.json"), "utf8");
  expect(index).not.toContain("never-persist-this");
  const resumed = new CloudBackup({ setup, origin: () => "https://studio.test", request: request as typeof fetch, changed: vi.fn() });
  expect((await resumed.restore(accountId)).items).toHaveLength(2);
  expect(await resumed.run({ accountId, accessToken: "again" })).toMatchObject({ completed: 0, skipped: 2 });
  await rm(video.path);
  expect(await resumed.run({ accountId, accessToken: "again" })).toMatchObject({ completed: 1, skipped: 1 });
});
it("reports partial failures, retries failed items and rejects mismatched accounts", async () => {
  const { backup, breakDownload, repair } = await fixture(); breakDownload();
  expect(await backup.run({ accountId, accessToken: "token" })).toMatchObject({ status: "partial", completed: 1, failed: 1 });
  repair();
  expect(await backup.run({ accountId, accessToken: "token" })).toMatchObject({ status: "completed", completed: 1, skipped: 1, failed: 0 });
  expect(await backup.run({ accountId: assetId, accessToken: "token" })).toMatchObject({ status: "failed", error: expect.stringContaining("身份") });
});
