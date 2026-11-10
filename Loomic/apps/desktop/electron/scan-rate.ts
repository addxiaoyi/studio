import { setTimeout as delay } from "node:timers/promises";

export function scanRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1024) throw new Error("扫描速度请选择 1–1024 MiB/s，或设为 0 不限速。");
  return value;
}
export class ScanRate {
  private next = 0;
  private rate: number;
  constructor(rateMiB: number, private readonly clock = () => performance.now(), private readonly wait = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal })) { this.rate = scanRate(rateMiB); }
  setRate(value: number) { this.rate = scanRate(value); this.next = this.clock(); }
  async reserve(bytes: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.rate) return;
    this.next = Math.max(this.next, this.clock()) + bytes / (this.rate * 1024 ** 2) * 1000;
    await this.wait(Math.max(0, this.next - this.clock()), signal);
    signal.throwIfAborted();
  }
}
