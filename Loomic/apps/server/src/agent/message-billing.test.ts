import { describe, expect, it, vi } from "vitest";
import { accumulateAgentTokenUsage, chargeAgentMessage, settleAgentMessage, usesHelsteraTokenBilling } from "./message-billing.js";

const user = { id: "user-1" } as never;

describe("HelsterAgent token billing", () => {
  it("bills public auto routing by tokens", () => {
    expect(usesHelsteraTokenBilling("openai:auto")).toBe(true);
    expect(usesHelsteraTokenBilling("custom-model")).toBe(false);
  });

  it("settles every model turn and ignores repeated or older cumulative usage", async () => {
    const deductCredits = vi.fn().mockResolvedValue("tx");
    const creditService = { deductCredits } as never;
    let charge = await chargeAgentMessage({ user, modelId: "openai:auto", viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "ws" } }) } as never, creditService, runId: "run", billOnUsage: true });
    charge = await settleAgentMessage({ user, charge, creditService, inputTokens: 1000, outputTokens: 1000 });
    charge = await settleAgentMessage({ user, charge, creditService, inputTokens: 2000, outputTokens: 2000 });
    charge = await settleAgentMessage({ user, charge, creditService, inputTokens: 2000, outputTokens: 2000 });
    charge = await settleAgentMessage({ user, charge, creditService, inputTokens: 1000, outputTokens: 1000 });
    expect(charge.amount).toBe(0.0012);
    expect(deductCredits).toHaveBeenCalledTimes(2);
    expect(deductCredits.mock.calls.map((call) => call[2])).toEqual([0.0006, 0.0006]);
  });
  it("accumulates usage across model turns", () => {
    const first = accumulateAgentTokenUsage({ inputTokens: 0, outputTokens: 0 }, { inputTokens: 1200, outputTokens: 400 });
    expect(accumulateAgentTokenUsage(first, { inputTokens: 800, outputTokens: 600 })).toEqual({
      inputTokens: 2000,
      outputTokens: 1000,
    });
  });

  it("deducts the final input/output token charge using the configured rates", async () => {
    const deductCredits = vi.fn().mockResolvedValue("tx-1");
    const refundCredits = vi.fn().mockResolvedValue("tx-2");
    const creditService = { deductCredits, refundCredits } as never;
    const charge = await chargeAgentMessage({
      user,
      modelId: "HelsterAgent",
      viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
      creditService,
      runId: "run-1",
      billOnUsage: true,
    });

    expect(deductCredits).not.toHaveBeenCalled();
    const settled = await settleAgentMessage({
      user,
      charge,
      creditService,
      inputTokens: 1000,
      outputTokens: 1000,
    });

    expect(deductCredits).toHaveBeenCalledWith("workspace-1", "user-1", 0.0006, "run-1", expect.any(String));
    expect(settled).toMatchObject({ amount: 0.0006, settled: true, provisional: false });
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("keeps pre-existing token-priced model billing unchanged", async () => {
    const deductCredits = vi.fn().mockResolvedValue("tx-legacy");
    await chargeAgentMessage({
      user,
      modelId: "agnes-3.0-flash",
      viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
      creditService: { deductCredits } as never,
      runId: "run-legacy",
    });

    expect(deductCredits).toHaveBeenCalledWith("workspace-1", "user-1", 0.1, "run-legacy", expect.any(String));
  });
});
