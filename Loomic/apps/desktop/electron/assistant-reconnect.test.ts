import { describe, expect, it } from "vitest";
import { assistantReconnectDelay, shouldReconnectAssistant } from "./assistant-reconnect.js";

describe("desktop assistant reconnect policy", () => {
  it("uses capped exponential backoff with jitter", () => {
    expect(assistantReconnectDelay(0, () => 0.5)).toBe(500);
    expect(assistantReconnectDelay(2, () => 0)).toBe(1_600);
    expect(assistantReconnectDelay(50, () => 1)).toBe(30_000);
  });

  it("stops retrying after server authentication rejection", () => {
    expect(shouldReconnectAssistant(4001)).toBe(false);
    expect(shouldReconnectAssistant(4003)).toBe(false);
    expect(shouldReconnectAssistant(1006)).toBe(true);
  });
});
