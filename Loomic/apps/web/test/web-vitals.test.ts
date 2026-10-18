import { describe, expect, it } from "vitest";
import { resolveMetricsEndpoint } from "../src/lib/web-vitals";

describe("web vitals endpoint", () => {
  it("sends local development metrics to the API server", () => {
    expect(resolveMetricsEndpoint("http://localhost:3001/")).toBe(
      "http://localhost:3001/api/metrics",
    );
  });

  it("uses the current origin when no API base URL is configured", () => {
    expect(resolveMetricsEndpoint("")).toBe("/api/metrics");
  });
});
