export class PeriodicTasks {
  private stopped = false;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly active = new Set<Promise<void>>();

  constructor(private readonly onError: (name: string, error: unknown) => void) {}

  every(name: string, intervalMs: number, task: () => Promise<unknown>, immediate = true) {
    if (this.stopped) throw new Error(`Cannot schedule ${name} after shutdown`);
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error(`Invalid interval for ${name}`);
    let busy = false;
    const cycle = () => {
      if (this.stopped || busy) return;
      busy = true;
      const work = Promise.resolve().then(task).then(() => undefined)
        .catch(error => this.onError(name, error))
        .finally(() => { busy = false; this.active.delete(work); });
      this.active.add(work);
    };
    const timer = setInterval(cycle, intervalMs);
    timer.unref();
    this.timers.add(timer);
    if (immediate) cycle();
  }

  async stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    await Promise.all([...this.active]);
  }
}
