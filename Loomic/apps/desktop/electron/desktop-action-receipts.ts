export class DesktopActionReceipts {
  private readonly pending = new Map<string, { approvalId: string; requestId: string }>();

  register(taskId: string, approvalId: string, requestId: string) {
    this.pending.set(taskId, { approvalId, requestId });
  }

  consume(taskId: string, approvalId: unknown, requestId: unknown) {
    const receipt = this.pending.get(taskId);
    if (!receipt || receipt.approvalId !== approvalId || receipt.requestId !== requestId) return false;
    this.pending.delete(taskId);
    return true;
  }

  clear(taskId: string) {
    this.pending.delete(taskId);
  }
}
