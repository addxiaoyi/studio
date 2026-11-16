import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { probeWritableStorage } from "./storage-probe.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("creates and checks the media scratch directory without touching user files", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-storage-probe-"));
  roots.push(root);
  const report = await probeWritableStorage(root);

  expect(report.ok).toBe(true);
  expect(report.disks.length).toBeGreaterThan(0);
  expect(
    report.disks.every((disk) => disk.availableBytes >= disk.requiredBytes),
  ).toBe(true);
});
