import { describe, expect, it } from "vitest";
import { shouldQuarantineCanceledReplay } from "./cancellation-recovery.js";

describe("canceled job recovery", () => {
  it("quarantines a replay after interruption when provider outcome is not checkpointed", () => {
    expect(shouldQuarantineCanceledReplay({
      attemptCount: 2,
      cancelRequestedAt: "2026-11-14T00:00:00.000Z",
      providerCheckpointExists: false,
    })).toBe(true);
  });

  it("continues replay when a provider checkpoint can be reused", () => {
    expect(shouldQuarantineCanceledReplay({
      attemptCount: 2,
      cancelRequestedAt: "2026-11-14T00:00:00.000Z",
      providerCheckpointExists: true,
    })).toBe(false);
  });

  it("does not quarantine the first live execution or an uncanceled retry", () => {
    expect(shouldQuarantineCanceledReplay({ attemptCount: 1, cancelRequestedAt: "now", providerCheckpointExists: false })).toBe(false);
    expect(shouldQuarantineCanceledReplay({ attemptCount: 2, cancelRequestedAt: null, providerCheckpointExists: false })).toBe(false);
  });
});
