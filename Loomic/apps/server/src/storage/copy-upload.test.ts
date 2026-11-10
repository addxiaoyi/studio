import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { copyUpload } from "./copy-upload.js";

it("shares file blocks on the same volume and keeps the asset after staging is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-copy-upload-"));
  try {
    const source = join(root, "video.part"), destination = join(root, "private-video", "video.mp4");
    const bytes = Buffer.alloc(1024 * 1024, 17);
    await writeFile(source, bytes);
    await copyUpload(root, "private-video", "video.mp4", source);
    const before = await stat(source), saved = await stat(destination);
    expect(saved.ino).toBe(before.ino);
    expect(saved.nlink).toBe(2);
    await unlink(source);
    expect((await stat(destination)).nlink).toBe(1);
    expect(await readFile(destination)).toEqual(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
