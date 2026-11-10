import { expect, it } from "vitest";
import { ScanRate } from "./scan-rate.js";

it("paces every block without building up an idle burst and allows immediate cancellation", async () => {
  let now = 0; const waits: number[] = [];
  const rate = new ScanRate(8, () => now, async delay => { waits.push(delay); now += delay; });
  const signal = new AbortController().signal;
  await rate.reserve(4 * 1024 ** 2, signal); await rate.reserve(4 * 1024 ** 2, signal);
  expect(now).toBe(1000);
  now += 30000; await rate.reserve(4 * 1024 ** 2, signal); expect(waits.at(-1)).toBe(500);
  rate.setRate(0); await rate.reserve(4 * 1024 ** 2, signal); expect(waits).toHaveLength(3);
  expect(() => rate.setRate(-1)).toThrow();
  const cancel = new AbortController(); rate.setRate(1);
  const realWait = new ScanRate(1).reserve(4 * 1024 ** 2, cancel.signal); cancel.abort();
  await expect(realWait).rejects.toThrow();
});
