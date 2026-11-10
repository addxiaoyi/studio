import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { CloudCopies } from "./cloud-copies.js";

it("rechecks the local file before releasing, preserves it and records a new restore identity", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-cloud-copy-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), assetId = randomUUID(), bytes = Buffer.from("local-original");
    const media = join(root, "Media", account), projects = join(root, "Projects", account); await mkdir(media); await mkdir(projects);
    const path = join(media, "original.png"), sha256 = createHash("sha256").update(bytes).digest("hex"); await writeFile(path, bytes);
    const indexPath = join(projects, "backup-index.json");
    await writeFile(indexPath, JSON.stringify({ account, items: [{ key: `asset:${assetId}`, receipt: { path, bytes: bytes.length, sha256, savedAt: new Date().toISOString() } }] }));
    const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => options?.method === "HEAD"
      ? new Response(null, { headers: { etag: `"${sha256}"`, "content-length": String(bytes.length) } })
      : Response.json({ ok: true, data: { state: "released", bytes: bytes.length } }));
    const copies = new CloudCopies({ setup, identity: async () => account, origin: () => "https://studio.test", request });
    const credentials = { accountId: account, accessToken: "test" };
    const stale = await copies.prepare(assetId, credentials); await writeFile(path, "changed");
    await expect(copies.apply(stale.id, credentials)).rejects.toThrow("已改变");
    expect(request.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    await writeFile(path, bytes);
    const plan = await copies.prepare(assetId, credentials);
    expect(await copies.apply(plan.id, credentials)).toEqual({ state: "released", bytes: bytes.length });
    expect(await readFile(path)).toEqual(bytes);
    const saved = JSON.parse(await readFile(indexPath, "utf8")).items[0];
    expect(saved.receipt.restoreEpoch).toMatch(/^[a-f\d-]{36}$/);
    expect(saved.cloudState).toBe("released");
    expect((await copies.list(credentials))[0].cloudState).toBe("released");
    await expect(copies.apply(plan.id, credentials)).rejects.toThrow("失效");
  } finally { await rm(root, { recursive: true, force: true }); }
});
