import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { recordWorkspaceReceipt, resolveWorkspaceReceipt } from "./workspace-receipt.js";
it("rebases old and new receipts to a copied workspace and refuses links or foreign account paths", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-migrate-")));
  try {
    const account = randomUUID(), original = join(root, "old"), moved = join(root, "new");
    await mkdir(join(original, "Media", account), { recursive: true });
    const path = join(original, "Media", account, "image.png"), bytes = Buffer.from("original"); await writeFile(path, bytes);
    const receipt = { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), savedAt: new Date().toISOString() };
    await cp(original, moved, { recursive: true });
    await rm(original, { recursive: true });
    expect((await resolveWorkspaceReceipt(moved, "Media", account, receipt))?.path).toBe(join(moved, "Media", account, "image.png"));
    expect((await resolveWorkspaceReceipt(moved, "Media", account, recordWorkspaceReceipt(original, receipt)))?.bytes).toBe(bytes.length);
    expect(await resolveWorkspaceReceipt(moved, "Media", randomUUID(), receipt)).toBeNull();
    expect(await resolveWorkspaceReceipt(moved, "Media", account, { ...receipt, relativePath: `Media/${account}/../../outside` })).toBeNull();
    await writeFile(join(moved, "Media", account, "image.png"), "changed");
    expect(await resolveWorkspaceReceipt(moved, "Media", account, receipt)).toBeNull();
    const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "image.png"), bytes);
    await rm(join(moved, "Media", account), { recursive: true }); await symlink(outside, join(moved, "Media", account), process.platform === "win32" ? "junction" : "dir");
    expect(await resolveWorkspaceReceipt(moved, "Media", account, receipt)).toBeNull();
  } finally { await rm(root, { recursive: true }); }
});
