import { createHash } from "node:crypto";
import { desktopAgentActionSchema, type DesktopAgentAction } from "@helstera/shared";

function fingerprint(action: DesktopAgentAction) {
  const parsed = desktopAgentActionSchema.parse(action);
  const { approvalId: _id, approvalToken: _token, ...fields } = parsed;
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export class DesktopActionApprovals {
  private readonly pending = new Map<string, { taskId: string; fingerprint: string; expiresAt: number }>();

  register(approvalId: string, action: DesktopAgentAction, expiresAt: string) {
    const expires = Date.parse(expiresAt);
    if (!Number.isFinite(expires)) return false;
    this.pending.set(approvalId, { taskId: action.taskId, fingerprint: fingerprint(action), expiresAt: expires });
    return true;
  }

  consume(action: DesktopAgentAction, now = Date.now()) {
    if (!action.approvalId || !action.approvalToken) return false;
    const pending = this.pending.get(action.approvalId);
    if (!pending || pending.expiresAt <= now || pending.taskId !== action.taskId || pending.fingerprint !== fingerprint(action)) return false;
    this.pending.delete(action.approvalId);
    return true;
  }

  clearTask(taskId: string) {
    for (const [id, approval] of this.pending) if (approval.taskId === taskId) this.pending.delete(id);
  }
}
