import type { StudioAiPlan } from "./studio-ai-edit";
import type { StudioSnapshot } from "./visualforge-runtime";
import type { VideoEditorExportReceipt } from "@helstera/shared";
import { readStudioPlan } from "./visualforge-storage";
import type { StudioRuntime } from "./visualforge-runtime";

export type StudioAiSession = { plan: StudioAiPlan; appliedRevision?: string; receiptSynced?: boolean; exportedOnce?: boolean; exportReceipt?: VideoEditorExportReceipt; undoneActions?: number[]; actionUndoAvailable?: boolean; completelyUndone?: boolean };

export async function readRecoveredStudioSession(userId: string, runtime: StudioRuntime) {
  const stored = await readStudioPlan<StudioAiSession>(userId);
  return stored ? recoverStudioAiSession(stored, await runtime.snapshot()) : null;
}

export function recoverStudioAiSession(session: StudioAiSession, snapshot: StudioSnapshot): StudioAiSession | null {
  if (session.plan.snapshot?.compositionId !== snapshot.compositionId) return null;
  const receipt = snapshot.editReceipt;
  if (receipt && receipt.id === session.plan.approval?.id) return {
    ...session, appliedRevision: receipt.revision, undoneActions: receipt.undone,
    actionUndoAvailable: receipt.canUndo, completelyUndone: receipt.complete,
  };
  const applied = session.plan.approval && snapshot.appliedEdits?.includes(session.plan.approval.id);
  const exportOnly = session.plan.actions.every(action => action.type === "export");
  if (!applied && !(exportOnly && session.appliedRevision)) {
    const { appliedRevision, ...pending } = session;
    return { ...pending, receiptSynced: false };
  }
  // The project action log is persisted with its source. A lost HTTP receipt is not a new edit.
  return { ...session, appliedRevision: session.appliedRevision ?? snapshot.revision };
}
