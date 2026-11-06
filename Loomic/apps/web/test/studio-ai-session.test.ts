import { expect, it } from "vitest";
import { normalizeModelPlan } from "@/lib/studio-ai-edit";
import { recoverStudioAiSession } from "@/lib/studio-ai-session";

const snapshot = { compositionId: "MyComp", revision: "a".repeat(64), duration: 2, format: "landscape" as const, captions: [], cut: null };
const approval = { id: "123e4567-e89b-42d3-a456-426614174000", fingerprint: "b".repeat(64), expiresAt: "2099-01-01T00:00:00Z", estimatedCredits: 0 as const };
const plan = { ...normalizeModelPlan({ summary: "字幕", actions: [{ type: "caption", text: "标题", startMs: 0, endMs: 1000 }] }, snapshot), approval };

it("recovers a lost receipt from the project log without scheduling another edit", () => {
  expect(recoverStudioAiSession({ plan }, { ...snapshot, revision: "c".repeat(64), appliedEdits: [approval.id] })?.appliedRevision).toBe("c".repeat(64));
});
it("does not treat a stored plan as an executed action", () => {
  expect(recoverStudioAiSession({ plan }, snapshot)?.appliedRevision).toBeUndefined();
  expect(recoverStudioAiSession({ plan }, { ...snapshot, compositionId: "Other" })).toBeNull();
});
