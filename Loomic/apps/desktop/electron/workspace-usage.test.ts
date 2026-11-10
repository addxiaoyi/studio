import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile, link } from "node:fs/promises";
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
