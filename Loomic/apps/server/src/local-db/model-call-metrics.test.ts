import { describe, expect, it } from "vitest";
import { summarizeModelCallRows } from "./model-call-metrics.js";

const row = (overrides: Record<string, unknown> = {}) => ({
  model_id: "gpt-image-2.5-2k",
  media_type: "image" as const,
  status: "succeeded",
  error_code: null,
  error_message: null,
  created_at: "2026-10-17T00:00:00.000Z",
  started_at: "2026-10-17T00:00:00.000Z",
  completed_at: "2026-10-17T00:01:00.000Z",
  failed_at: null,
  ...overrides,
});

describe("model call metrics", () => {
  it("calculates success, timeout and p95 metrics by model", () => {
    const rows = [
      row(), row(), row(), row(),
      row({ status: "dead_letter", error_code: "upstream_outcome_unknown", error_message: "timeout", completed_at: null, failed_at: "2026-10-17T00:03:00.000Z" }),
    ];
    const result = summarizeModelCallRows(rows, 24);
    expect(result.metrics).toEqual([expect.objectContaining({ total: 5, succeeded: 4, failed: 1, timed_out: 1, success_rate: 0.8, timeout_rate: 0.2, p95_latency_ms: 180000 })]);
    expect(result.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ metric: "timeout_rate", severity: "warning" })]));
  });

  it("does not alert on small samples", () => {
    const result = summarizeModelCallRows([row({ status: "dead_letter", error_code: "timeout", completed_at: null, failed_at: "2026-10-17T00:01:00.000Z" })], 24);
    expect(result.alerts).toEqual([]);
  });
});
