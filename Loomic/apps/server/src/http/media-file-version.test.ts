import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mediaFileVersion } from "./media-file-version.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("media file validators", () => {
  it("changes after an in-place same-size rewrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-media-version-"));
    directories.push(directory);
    const path = join(directory, "recording.webm");
    await writeFile(path, "first-video");
    await utimes(path, new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));

    const firstVersion = await mediaFileVersion(path);
    expect(await mediaFileVersion(path)).toBe(firstVersion);
    await writeFile(path, "other-video");
    await utimes(path, new Date("2021-01-01T00:00:00.000Z"), new Date("2021-01-01T00:00:00.000Z"));
    const nextVersion = await mediaFileVersion(path);

    expect(nextVersion).not.toBe(firstVersion);
    expect(nextVersion).toMatch(/^"[a-f0-9]{64}"$/);
  });
});
