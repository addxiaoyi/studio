import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
import { MediaRelinkBatch } from "./media-relink-batch.js";

it("previews ambiguous and missing matches without writes, confirms selected files and rejects stale receipts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-batch-")));
  try {
    const setup = new DesktopSetup(join(root, "profile")); await setup.choose(root); await setup.complete({ autoBackup: false, agentAccess: false });
    const account = randomUUID(), ids = [randomUUID(), randomUUID(), randomUUID()];
    const folder = join(root, "moved"), projects = join(root, "Projects", account);
    await mkdir(folder); await mkdir(projects); await mkdir(join(root, "Media", account));
    const original = { account, items: ids.map((id, i) => ({ key: `asset:${id}`, name: `素材${i}`, receipt: { path: join(root, "Media", account, `${i}.mp4`), bytes: 4, sha256: createHash("sha256").update(`000${i}`).digest("hex"), savedAt: new Date().toISOString() } })) };
    const indexPath = join(projects, "backup-index.json"); await writeFile(indexPath, JSON.stringify(original));
    await writeFile(join(folder, "a.mp4"), "0000"); await writeFile(join(folder, "b.mp4"), "0000"); await writeFile(join(folder, "c.mp4"), "0001");
    const batch = new MediaRelinkBatch(setup), plan = await batch.prepare(account, folder);
    expect(plan.items.map(item => item.status)).toEqual(["ambiguous", "matched", "missing"]);
    expect(JSON.parse(await readFile(indexPath, "utf8"))).toEqual(original);
    await expect(batch.apply(plan.id, [{ assetId: ids[0], candidateId: "unknown" }])).rejects.toThrow("候选");
    const first = await batch.apply(plan.id, [{ assetId: ids[0], candidateId: plan.items[0]!.candidates[1]!.id }]);
    expect(first.items[0]?.ok).toBe(true);
    const saved = JSON.parse(await readFile(indexPath, "utf8"));
    expect(await readFile(saved.items[0].receipt.path, "utf8")).toBe("0000");
    expect(saved.items[1]).toEqual(original.items[1]);
    expect(await readFile(join(folder, "b.mp4"), "utf8")).toBe("0000");
    const next = await batch.prepare(account, folder);
    saved.items[1].receipt.sha256 = "f".repeat(64); await writeFile(indexPath, JSON.stringify(saved));
    const failed = await batch.apply(next.id, [{ assetId: ids[1], candidateId: next.items[1]!.candidates[0]!.id }]);
    expect(failed.items[0]?.ok).toBe(false); expect(failed.items[0]?.error).toContain("索引已改变");
    await expect(batch.apply(next.id, [])).rejects.toThrow();
    await expect(batch.prepare(account, join(root, "Media", randomUUID()))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
