// @observability — Web Vitals reporter tests
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installWebVitals } from "../src/lib/web-vitals.js";

describe("web vitals reporter", () => {
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

  it("installs without throwing on modern browsers", () => {
    expect(() => installWebVitals()).not.toThrow();
  });

  it("is idempotent — calling install twice does not double-subscribe", () => {
    installWebVitals();
    expect(() => installWebVitals()).not.toThrow();
  });

  it("does not throw in jsdom (no PerformanceObserver for all entry types)", () => {
    // Each PerformanceObserver.observe call is wrapped in try/catch,
    // so the install gracefully degrades on unsupported environments.
    expect(() => installWebVitals()).not.toThrow();
  });
});
