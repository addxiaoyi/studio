import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { WorkspaceUsage } from "./workspace-usage.js";
import { MediaMerge } from "./media-merge.js";

it("previews all project references and preserves every asset id and path when merging content", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-merge-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), ids = [randomUUID(), randomUUID()], media = join(root, "Media", account), projects = join(root, "Projects", account);
    await mkdir(media); await mkdir(projects);
    const content = Buffer.from("same image bytes"), sha256 = createHash("sha256").update(content).digest("hex");
    const paths = [join(media, "a.png"), join(media, "b.png")]; for (const path of paths) await writeFile(path, content);
    const index = { account, items: ids.map((id, i) => ({ key: `asset:${id}`, receipt: { path: paths[i], bytes: content.length, sha256, savedAt: new Date().toISOString() } })) };
    const indexPath = join(projects, "backup-index.json"); await writeFile(indexPath, JSON.stringify(index));
    for (let i = 0; i < 2; i++) await writeFile(join(projects, `${i}.json`), JSON.stringify({ format: "helstera-project-backup", formatVersion: 1, project: { id: randomUUID(), name: `工程${i}`, workspace: { ownerUserId: account } }, canvas: { id: randomUUID(), content: { elements: [{ type: "image", link: `/api/uploads/${ids[i]}/file` }] } }, sessions: [] }));
    const usage = new WorkspaceUsage(setup), report = await usage.scan(account, true);
    const files = report.duplicates[0]!.files, merge = new MediaMerge(setup, usage);
    const plan = await merge.prepare(account, files[0]!.id, [files[1]!.id]);
    expect(plan.projects.map(project => project.name).sort()).toEqual(["工程0", "工程1"]);
    expect(plan.assets).toBe(2); expect((await stat(paths[0]!)).ino).not.toBe((await stat(paths[1]!)).ino);
    await expect(merge.apply(plan.id, false)).rejects.toThrow("确认");
    expect((await stat(paths[0]!)).ino).not.toBe((await stat(paths[1]!)).ino);
    await writeFile(paths[1]!, Buffer.alloc(content.length, 9));
    await expect(merge.apply(plan.id, true)).rejects.toThrow("原文件已改变");
    await writeFile(paths[1]!, content);
    const changedPlan = await merge.prepare(account, files[0]!.id, [files[1]!.id]);
    await writeFile(join(projects, "note.json"), "{}");
    await expect(merge.apply(changedPlan.id, true)).rejects.toThrow("快照");
    await rm(join(projects, "note.json"));
    const fresh = await merge.prepare(account, files[0]!.id, [files[1]!.id]);
    const merged = await merge.apply(fresh.id, true);
    expect(merged.mergedFiles).toBe(1); expect(merged.errors).toEqual([]);
    expect((await stat(paths[0]!)).ino).toBe((await stat(paths[1]!)).ino);
    expect((await readFile(paths[1]!)).equals(content)).toBe(true);
    expect(JSON.parse(await readFile(indexPath, "utf8"))).toEqual(index);
    expect((await usage.scan(account, true)).duplicateGroups).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
