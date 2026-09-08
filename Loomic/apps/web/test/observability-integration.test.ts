// @observability — Combined observability: error + vitals share same plumbing
// Sanity-check that both reporters can be installed simultaneously
// without stepping on each other.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installErrorReporter, reportError } from "../src/lib/error-reporter.js";
import { installWebVitals } from "../src/lib/web-vitals.js";

describe("observability integration", () => {
  let originalSendBeacon: typeof navigator.sendBeacon | undefined;

  beforeEach(() => {
    originalSendBeacon = navigator.sendBeacon;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => true),
      writable: true,
    });
  });

  afterEach(() => {
    if (originalSendBeacon) {
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: originalSendBeacon,
        writable: true,
      });
    }
  });

  it("installs both reporters without conflict", async () => {
    installErrorReporter();
    await installWebVitals();
    // Both should be installed; neither should throw
    expect(true).toBe(true);
  });

  it("reportError still works after web-vitals install", async () => {
    installErrorReporter();
    await installWebVitals();
    expect(() => reportError(new Error("post-vitals"))).not.toThrow();
  });
});
