import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { WorkspaceUsage } from "./workspace-usage.js";

it("classifies local bytes and verifies duplicate content without counting hardlinks as reclaimable copies", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-usage-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), media = join(root, "Media", account); await mkdir(media);
    await writeFile(join(media, "first.mp4"), "same-file"); await writeFile(join(media, "second.mp4"), "same-file");
    await link(join(media, "first.mp4"), join(media, "linked.mp4"));
    await writeFile(join(media, "different.mp4"), "not-equal"); await writeFile(join(root, "Exports", "film.mp4"), "export");
    const usage = new WorkspaceUsage(setup);
    const report = await usage.scan(account, true);
    expect(report.categories.find(row => row.id === "media")?.bytes).toBe(36);
    expect(report.categories.find(row => row.id === "exports")?.bytes).toBe(6);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]?.extraBytes).toBe(9);
    expect(report.duplicates[0]?.files).toHaveLength(3);
    expect(report.hashedBytes).toBe(27);
    expect(await usage.reveal(report.duplicates[0]!.files[0]!.id)).toContain(media);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("resumes a paused file after restart and invalidates completed checkpoints when a file changes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-scan-resume-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), folder = join(root, "Media", account); await mkdir(folder);
    const bytes = Buffer.alloc(12 * 1024 ** 2, 5);
    await writeFile(join(folder, "a.mp4"), bytes); await writeFile(join(folder, "b.mp4"), bytes);
    let paused = false;
    const first = new WorkspaceUsage(setup, state => { if (!paused && state.phase === "hashing" && state.fileBytes >= 4 * 1024 ** 2) { paused = true; first.cancel(); } });
    await expect(first.scan(account, true)).rejects.toThrow("已暂停");
    const state = await first.savedState(account); expect(state?.phase).toBe("paused");
    expect(state?.fileBytes).toBeGreaterThanOrEqual(4 * 1024 ** 2);
    const restarted = new WorkspaceUsage(setup), completed = await restarted.scan(account, true);
    expect(completed.duplicates).toHaveLength(1); expect(completed.resumedBytes).toBeGreaterThanOrEqual(4 * 1024 ** 2);
    expect(completed.readBytes).toBeLessThan(bytes.length * 2);
    expect((await restarted.savedState(account))?.phase).toBe("completed");
    await writeFile(join(folder, "a.mp4"), Buffer.alloc(bytes.length, 9));
    const changed = await new WorkspaceUsage(setup).scan(account, true);
    expect(changed.duplicates).toHaveLength(0); expect(changed.readBytes).toBe(bytes.length);
    expect((await readFile(join(folder, "b.mp4"))).equals(bytes)).toBe(true);
    const reset = restarted.clearProgress(account);
    expect(await restarted.savedState(account)).toBeNull(); await reset;
    await writeFile(join(root, "Cache", "Scans", `${account}.json`), "{broken");
    await expect(restarted.scan(account, true)).rejects.toThrow("清除扫描进度");
    expect(restarted.busy).toBe(false);
    await restarted.clearProgress(account);
    expect(await restarted.savedState(account)).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});
