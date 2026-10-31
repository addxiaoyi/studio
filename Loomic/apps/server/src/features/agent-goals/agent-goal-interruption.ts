export class ReadOnlyGoalPausedError extends Error {
  constructor() {
    super("Read-only website capture paused. Resuming restarts this capture; existing evidence is retained.");
    this.name = "ReadOnlyGoalPausedError";
  }
}
