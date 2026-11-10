import { mkdtemp, readFile, realpath, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { DesktopSetup } from "./desktop-setup.js";
const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
it("requires a real chosen directory and restores completed configuration", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-setup-"))); roots.push(root);
  const setup = new DesktopSetup(join(root, "profile"));
  expect((await setup.status()).completed).toBe(false);
  await expect(setup.complete({ autoBackup: true, agentAccess: false })).rejects.toThrow("选择");
  await setup.choose(root);
  await setup.complete({ autoBackup: true, agentAccess: false });
  const restored = await new DesktopSetup(join(root, "profile")).status();
  expect(restored).toMatchObject({ completed: true, root, autoBackup: true, agentAccess: false, available: true });
  expect(JSON.parse(await readFile(join(root, "profile", "asset-storage.json"), "utf8")).directory).toBe(join(root, "Media"));
});
it("resolves a chosen directory alias but rejects a redirected Media subfolder", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-setup-"))); roots.push(root);
  const actual = join(root, "actual"), alias = join(root, "alias"), outside = join(root, "outside");
  await mkdir(actual); await mkdir(outside);
  await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
  const setup = new DesktopSetup(join(root, "profile"));
  expect((await setup.choose(alias)).root).toBe(actual);
  await symlink(outside, join(actual, "Media"), process.platform === "win32" ? "junction" : "dir");
  await expect(setup.complete({ autoBackup: false, agentAccess: false })).rejects.toThrow("链接");
});
it("does not call a deleted directory ready or silently ignore broken settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-setup-")); roots.push(root);
  const setup = new DesktopSetup(root);
  await writeFile(join(root, "desktop-setup.json"), JSON.stringify({ version: 1, completed: true, root: join(root, "gone"), autoBackup: false, agentAccess: false }));
  expect(await setup.status()).toMatchObject({ completed: true, available: false });
  await writeFile(join(root, "desktop-setup.json"), "broken");
  expect(await setup.status()).toMatchObject({ completed: false, available: false, error: expect.any(String) });
});
