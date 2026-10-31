import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAssetFolderStatus, verifyAssetFolder } from "./asset-folder.js";

const folders: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "helstera-folder-test-"));
  folders.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of folders.splice(0)) await rm(directory, { recursive: true });
});

describe("native asset folder verification", () => {
  it("writes and reads a real disk probe without leaving test files or changing existing assets", async () => {
    const directory = await fixture();
    await writeFile(join(directory, "existing.txt"), "keep");
    const status = await verifyAssetFolder(directory);
    expect(status).toMatchObject({ kind: "native", path: directory });
    expect(status.availableBytes).toBeGreaterThan(0);
    expect(await readdir(directory)).toEqual(["existing.txt"]);
    expect(await readFile(join(directory, "existing.txt"), "utf8")).toBe("keep");
  });

  it("does not report a removed directory as granted", async () => {
    const directory = await fixture();
    const settings = join(directory, "settings.json");
    await writeFile(settings, JSON.stringify({ directory: join(directory, "missing") }));
    expect(await readAssetFolderStatus(settings)).toMatchObject({ permission: "denied", errorCode: "ENOENT" });
  });

  it("distinguishes first launch from invalid settings", async () => {
    const directory = await fixture();
    const settings = join(directory, "settings.json");
    expect(await readAssetFolderStatus(settings)).toMatchObject({ permission: "unselected" });
    await writeFile(settings, "{invalid");
    await expect(readAssetFolderStatus(settings)).rejects.toThrow("settings could not be read");
    await expect(verifyAssetFolder("relative-folder")).rejects.toThrow("absolute");
  });
});
