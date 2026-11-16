type CloseWork = () => unknown | Promise<unknown>;

export async function drainInOrder(phases: readonly (readonly CloseWork[])[]) {
  const failures: unknown[] = [];
  for (const phase of phases) {
    const outcomes = await Promise.allSettled(
      phase.map((close) => Promise.resolve().then(close)),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") failures.push(outcome.reason);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Service drain could not persist all active work",
    );
}

export class ServiceLifecycle {
  private closing = false;
  private closeWork: CloseWork[] = [];
  private drainingWork?: Promise<void>;
  get draining() {
    return this.closing;
  }
  onDrain(action: CloseWork) {
    this.closeWork.push(action);
  }
  drain() {
    if (this.drainingWork) return this.drainingWork;
    this.closing = true;
    this.drainingWork = drainInOrder([this.closeWork]);
    return this.drainingWork;
  }
}
