import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createProcessReceipt } from "./process-receipt.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

it("persists ready and drained states for the same process instance", async () => {
  const folder = await mkdtemp(join(tmpdir(), "helstera-receipt-"));
  folders.push(folder);
  const path = join(folder, "worker.json");
  const receipt = createProcessReceipt("worker", path);
  await receipt.ready();
  const ready = JSON.parse(await readFile(path, "utf8"));
  expect(ready).toMatchObject({ pid: process.pid, role: "worker", state: "ready" });
  expect(ready.instanceId).toEqual(expect.any(String));
  await receipt.drained();
  const drained = JSON.parse(await readFile(path, "utf8"));
  expect(drained).toMatchObject({ ...ready, state: "drained", updatedAt: expect.any(String) });
});

it("reports write failures instead of claiming readiness", async () => {
  const folder = await mkdtemp(join(tmpdir(), "helstera-receipt-"));
  folders.push(folder);
  const receipt = createProcessReceipt("worker", join(folder, "missing", "worker.json"));
  await expect(receipt.ready()).rejects.toThrow();
});

it("rejects relative receipt destinations", () => {
  expect(() => createProcessReceipt("server", "worker.json")).toThrow("absolute");
});

it("allows ordinary launches without release receipts", async () => {
  const receipt = createProcessReceipt("server", undefined);
  await expect(receipt.ready()).resolves.toBeUndefined();
  await expect(receipt.drained()).resolves.toBeUndefined();
});
