import { describe, expect, it, vi } from "vitest";
import { createGenerationApprovalService } from "./generation-approval-service.js";

const baseInput = {
  workspaceId: "workspace-1",
  userId: "user-1",
  jobType: "video_generation" as const,
  model: "minimax-h3",
  payload: { prompt: "orbit", duration: 5, input_images: ["asset-1"] },
  estimatedCredits: 2.25,
};

describe("generation approval service", () => {
  it("does not consume an already approved request while recovering a missing job", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "approval-1" }] });
    const service = createGenerationApprovalService({ query } as any);

    await expect(service.gate(baseInput)).resolves.toEqual({ state: "approved", approvalId: "approval-1" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).toContain("select id from generation_approvals");
    expect(String(query.mock.calls[1]?.[0])).not.toContain("set consumed_at");
  });

  it("returns a new confirmation when no matching approval is pending", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ enabled: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "approval-2", expires_at: "2030-01-01T00:00:00.000Z" }] });
    const service = createGenerationApprovalService({ query } as any);

    const result = await service.gate(baseInput);
    expect(result).toMatchObject({ state: "confirmation_required", request: { approvalId: "approval-2", jobType: "video_generation", model: "minimax-h3" } });
  });

  it("reuses the existing pending confirmation for the same request and canvas", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ enabled: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "approval-existing", expires_at: "2030-01-01T00:00:00.000Z" }] });
    const service = createGenerationApprovalService({ query } as any);

    const result = await service.gate({ ...baseInput, context: { canvasId: "canvas-1", sessionId: "session-1" } });

    expect(result).toMatchObject({
      state: "confirmation_required",
      request: { approvalId: "approval-existing", context: { canvasId: "canvas-1", sessionId: "session-1" } },
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[3]?.[0])).toContain("status = 'pending'");
    expect(query.mock.calls[3]?.[1]).toEqual(["workspace-1", "user-1", "video_generation", "minimax-h3", expect.any(String), "canvas-1", "session-1"]);
  });

  it("returns the winner when concurrent identical requests hit the pending unique index", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate pending approval"), { code: "23505" });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ enabled: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(uniqueViolation)
      .mockResolvedValueOnce({ rows: [{ id: "approval-winner", expires_at: "2030-01-01T00:00:00.000Z" }] });
    const service = createGenerationApprovalService({ query } as any);

    await expect(service.gate({ ...baseInput, context: { canvasId: "canvas-1" } })).resolves.toMatchObject({
      state: "confirmation_required",
      request: { approvalId: "approval-winner" },
    });
  });

  it("keeps an approved confirmation consumable only once", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "approval-3" }] });
    const service = createGenerationApprovalService({ query } as any);

    await expect(service.gate({ ...baseInput, approvalId: "approval-3" })).resolves.toEqual({ state: "approved", approvalId: "approval-3" });
    expect(String(query.mock.calls[1]?.[0])).toContain("consumed_at = now()");
  });
});
