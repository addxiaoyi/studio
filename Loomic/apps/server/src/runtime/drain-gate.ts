export class DrainGate {
  private closing = false;
  private readonly active = new Set<Promise<void>>();

  enter() {
    this.assertOpen();
    let finish!: () => void;
    const work = new Promise<void>(resolve => { finish = resolve; });
    this.active.add(work);
    return () => { this.active.delete(work); finish(); };
  }

  assertOpen() {
    if (this.closing) throw new Error("服务正在切换，请稍后继续；已提交的任务会保留。");
  }

  async drain() {
    this.closing = true;
    await Promise.all([...this.active]);
  }
}

export function trackStream<T>(gate: DrainGate, stream: (runId: string) => AsyncGenerator<T>, settle: (runId: string) => Promise<unknown>) {
  return async function* (runId: string): AsyncGenerator<T> {
    const leave = gate.enter();
    try { yield* stream(runId); }
    finally {
      try { await settle(runId); }
      finally { leave(); }
    }
  };
}
