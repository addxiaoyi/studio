import { expect, it } from "vitest";
import { DrainGate, trackStream } from "./drain-gate.js";
import { ServiceLifecycle } from "./lifecycle.js";

it("rejects new streams but waits for every existing stream to settle", async () => {
  const gate = new DrainGate();
  const first = gate.enter(), second = gate.enter();
  let drained = false;
  const stop = gate.drain().then(() => { drained = true; });
  expect(() => gate.enter()).toThrow("服务正在切换");
  first(); first();
  await Promise.resolve();
  expect(drained).toBe(false);
  second();
  await stop;
  expect(drained).toBe(true);
});

it("runs other drain callbacks even if one throws synchronously", async () => {
  const lifecycle = new ServiceLifecycle();
  let saved = false;
  lifecycle.onDrain(() => { throw new Error("broken shutdown handler"); });
  lifecycle.onDrain(async () => { saved = true; });
  await expect(lifecycle.drain()).rejects.toThrow("persist");
  expect(saved).toBe(true);
  expect(lifecycle.draining).toBe(true);
});

it("waits for billing settlement even if a consumer closes its stream", async () => {
  const gate = new DrainGate();
  let finishBilling!: () => void;
  const billing = new Promise<void>(resolve => { finishBilling = resolve; });
  const stream = trackStream(gate, async function* () { yield "partial"; yield "final"; }, () => billing)("run-1");
  expect(await stream.next()).toEqual({ value: "partial", done: false });
  let drained = false;
  const stopping = gate.drain().then(() => { drained = true; });
  const closing = stream.return(undefined);
  await Promise.resolve();
  expect(drained).toBe(false);
  finishBilling();
  await Promise.all([stopping, closing]);
  expect(drained).toBe(true);
});
