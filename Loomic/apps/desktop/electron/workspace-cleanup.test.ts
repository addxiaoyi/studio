import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { WorkspaceCleanup } from "./workspace-cleanup.js";
import { diskWarning } from "./disk-space.js";
import { RestoreJournal } from "./restore-journal.js";

it("warns at absolute and relative low-space thresholds", () => {
  expect(diskWarning(256 * 1024 ** 2, 100 * 1024 ** 3)).toBe("critical");
  expect(diskWarning(4 * 1024 ** 3, 100 * 1024 ** 3)).toBe("low");
  expect(diskWarning(8 * 1024 ** 3, 1000 * 1024 ** 3)).toBe("low");
  expect(diskWarning(20 * 1024 ** 3, 100 * 1024 ** 3)).toBe("normal");
});

it("keeps shared media, rejects a stale cleanup plan and only removes the confirmed project's files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-cleanup-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), first = randomUUID(), second = randomUUID(), shared = randomUUID(), exclusive = randomUUID();
    const projects = join(root, "Projects", account), media = join(root, "Media", account);
    await mkdir(projects); await mkdir(media);
    const snapshot = (id: string, assets: string[]) => ({ format: "helstera-project-backup", formatVersion: 1, project: { id, name: id, workspace: { ownerUserId: account } }, canvas: { id: randomUUID(), content: { elements: assets.map(id => ({ id, link: `/api/uploads/${id}/file` })) } }, sessions: [] });
    await writeFile(join(projects, "first.json"), JSON.stringify(snapshot(first, [shared, exclusive])));
    await writeFile(join(projects, "second.json"), JSON.stringify(snapshot(second, [shared])));
    const items = [];
    for (const id of [shared, exclusive]) {
      const path = join(media, `${id}.png`); await writeFile(path, id);
      items.push({ key: `asset:${id}`, receipt: { path, bytes: id.length, sha256: createHash("sha256").update(id).digest("hex"), savedAt: new Date().toISOString() } });
    }
    await writeFile(join(projects, "backup-index.json"), JSON.stringify({ account, items }));
    const journal = new RestoreJournal(setup);
    await journal.queue(account, join(projects, "first.json"), "待恢复工程", createHash("sha256").update(await readFile(join(projects, "first.json"))).digest("hex"));
    const cleanup = new WorkspaceCleanup(setup);
    const stale = await cleanup.prepare(account, first);
    await writeFile(join(projects, "new.json"), JSON.stringify(snapshot(second, [shared, exclusive])));
    await expect(cleanup.apply(stale.id)).rejects.toThrow("已改变");
    await rm(join(projects, "new.json"));
    const plan = await cleanup.prepare(account, first);
    expect(plan.sharedMedia).toBe(1); expect(plan.mediaFiles).toBe(1); expect(plan.snapshots).toBe(1);
    expect(plan.canceledTasks).toBe(1);
    const applied = await cleanup.apply(plan.id);
    expect(applied.removedFiles).toBe(2);
    expect(await readFile(join(media, `${shared}.png`), "utf8")).toBe(shared);
    await expect(stat(join(media, `${exclusive}.png`))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(projects, "second.json"))).isFile()).toBe(true);
    expect(await journal.list(account)).toEqual([]);
    await expect(cleanup.apply(plan.id)).rejects.toThrow("失效");
  } finally { await rm(root, { recursive: true, force: true }); }
});
