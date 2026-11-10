import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { MediaRelink } from "./media-relink.js";
import { resolveWorkspaceReceipt } from "./workspace-receipt.js";

it("relinks renamed media without copying, imports external originals only on confirmation and rejects changed files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-relink-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), asset = randomUUID(), bytes = Buffer.from("original-media");
    const media = join(root, "Media", account), projects = join(root, "Projects", account); await mkdir(media); await mkdir(projects);
    const original = join(media, "old.png"), indexPath = join(projects, "backup-index.json"); await writeFile(original, bytes);
    await writeFile(indexPath, JSON.stringify({ account, items: [{ key: `asset:${asset}`, receipt: { path: original, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), savedAt: new Date().toISOString() } }] }));
    const nested = join(media, "新目录"); await mkdir(nested); const renamed = join(nested, "改名.png"); await rename(original, renamed);
    const relink = new MediaRelink(setup);
    await expect(relink.prepare(account, "../outside", renamed)).rejects.toThrow("标识无效");
    const plan = await relink.prepare(account, asset, renamed); expect(plan.willCopy).toBe(false);
    expect(JSON.parse(await readFile(indexPath, "utf8")).items[0].receipt.path).toBe(original);
    await relink.apply(plan.id);
    let saved = JSON.parse(await readFile(indexPath, "utf8")).items[0].receipt;
    expect(saved.relativePath).toBe(`Media/${account}/新目录/改名.png`);
    expect((await resolveWorkspaceReceipt(root, "Media", account, saved))?.path).toBe(renamed);
    const external = join(root, "external.png"); await writeFile(external, bytes);
    const stale = await relink.prepare(account, asset, external); await writeFile(external, "changed");
    await expect(relink.apply(stale.id)).rejects.toThrow("已改变");
    await writeFile(external, bytes);
    const imported = await relink.prepare(account, asset, external); expect(imported.willCopy).toBe(true);
    await relink.apply(imported.id); saved = JSON.parse(await readFile(indexPath, "utf8")).items[0].receipt;
    expect(saved.relativePath).toContain(`Media/${account}/Relinked/`);
    expect(await readFile(saved.path)).toEqual(bytes); expect(await readFile(external)).toEqual(bytes);
    await expect(relink.prepare(account, asset, join(root, "missing.png"))).rejects.toThrow();
    await expect(relink.apply(imported.id)).rejects.toThrow("失效");
  } finally { await rm(root, { recursive: true, force: true }); }
});
