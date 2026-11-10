type CloseWork = () => Promise<unknown>;
export class ServiceLifecycle {
  private closing = false;
  private closeWork: CloseWork[] = [];
  private drainingWork?: Promise<void>;
  get draining() { return this.closing; }
  onDrain(action: CloseWork) { this.closeWork.push(action); }
  drain() {
    if (this.drainingWork) return this.drainingWork;
    this.closing = true;
    this.drainingWork = (async () => {
      const outcomes = await Promise.allSettled(this.closeWork.map(close => Promise.resolve().then(close)));
      const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(failure => failure.reason), "Service drain could not persist all active work");
    })();
    return this.drainingWork;
  }
}
