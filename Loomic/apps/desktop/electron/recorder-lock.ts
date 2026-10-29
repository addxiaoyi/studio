export class RecorderLock {
  private owner: string | null = null;

  acquire(taskId: string) {
    if (!taskId) throw new Error("A task id is required to start recording.");
    if (this.owner) throw new Error("The screen recorder is busy with another task.");
    this.owner = taskId;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.owner === taskId) this.owner = null;
    };
  }
}
