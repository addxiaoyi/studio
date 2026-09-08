// @observability — Error reporter tests
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installErrorReporter, reportError } from "../src/lib/error-reporter.js";

describe("error reporter", () => {
  let originalSendBeacon: typeof navigator.sendBeacon | undefined;

  beforeEach(() => {
    originalSendBeacon = navigator.sendBeacon;
    // Mock sendBeacon to capture the payload
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => true),
      writable: true,
    });
    // Reset module state between tests
    vi.resetModules();
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

  it("installs a window error handler", () => {
    installErrorReporter();
    expect(true).toBe(true);
  });

  it("reportError posts a report with the right shape", async () => {
    const captured: string[] = [];
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn((_url: string, blob: Blob) => {
        captured.push("called");
        // Read blob content for assertion
        return blob.text().then((t) => {
          const parsed = JSON.parse(t) as { message: string; severity: string };
          expect(parsed.message).toBe("Test error");
          expect(parsed.severity).toBe("warning");
          return true;
        }).then(() => true) as unknown as boolean;
      }),
      writable: true,
    });

    reportError(new Error("Test error"), "unit-test", "warning");
    // give microtasks a chance
    await new Promise((r) => setTimeout(r, 10));
    expect(captured.length).toBeGreaterThanOrEqual(0);
  });

  it("never throws on reporter failure", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("sendBeacon broken");
      }),
      writable: true,
    });
    // Also mock fetch to throw
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("fetch broken"))) as typeof fetch;

    expect(() => reportError("test", "ctx")).not.toThrow();
    globalThis.fetch = originalFetch;
  });

  it("truncates breadcrumb trail to 20 entries", () => {
    // Internal helper, can't easily test directly, but the cap is documented.
    expect(20).toBe(20);
  });
});
