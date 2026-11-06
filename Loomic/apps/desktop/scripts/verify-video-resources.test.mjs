import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyWindowsVideoResources } from "./verify-video-resources.mjs";
import beforePack from "./check-video-before-pack.cjs";

test("Windows video resources must include non-empty binaries and notices", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "loom-video-resources-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => verifyWindowsVideoResources(directory), /ffmpeg\.exe/);
  for (const name of ["ffmpeg.exe", "ffprobe.exe", "LICENSE.txt", "SOURCE.txt"]) {
    writeFileSync(join(directory, name), "test");
  }
  assert.throws(() => verifyWindowsVideoResources(directory), /ffmpeg-source\.tar/);
  for (const name of ["ffmpeg-source.tar", "x264-source.tar", "ffmpeg-config.mak", "x264-config.mak"]) {
    writeFileSync(join(directory, name), "test");
  }
  assert.doesNotThrow(() => verifyWindowsVideoResources(directory));
  writeFileSync(join(directory, "SOURCE.txt"), "");
  assert.throws(() => verifyWindowsVideoResources(directory), /non-empty.*SOURCE\.txt/);
});

test("Windows packaging checks resources even on another host platform", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "loom-video-pack-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const context = { electronPlatformName: "win32", packager: { projectDir: directory } };
  await assert.rejects(beforePack.default(context), /ffmpeg\.exe/);
  await assert.doesNotReject(beforePack.default({ ...context, electronPlatformName: "linux" }));
});
