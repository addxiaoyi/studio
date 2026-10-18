import { describe, expect, it, vi } from "vitest";
import {
  buildInsightSummary,
  persistContentInsight,
  validateMetricRelations,
} from "./metrics.js";
import { summarizeMetrics } from "./publishing-scheduler.js";

const input = {
  packageId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  platform: "douyin" as const,
  accountAlias: "主账号",
  postUrl: "https://example.com/post/1",
  publishedAt: "2026-09-13T00:00:00.000Z",
  impressions: 1000,
  views: 800,
  completions: 400,
  likes: 10,
  comments: 20,
  shares: 30,
  saves: 40,
  clicks: 80,
  leads: 8,
  conversions: 4,
  spendCny: 20,
  revenueCny: 100,
};

describe("feed metrics", () => {
  it("normalizes PostgreSQL bigint strings and computes weighted rates", () => {
    const summary = summarizeMetrics([
      { impressions: "1000", views: "800", completions: "400", likes: "10", comments: "20", shares: "30", saves: "40", clicks: "80", conversions: "4", spend_cny: "20", revenue_cny: "100" },
      { impressions: "100", views: "100", completions: "0", likes: "0", comments: "0", shares: "0", saves: "0", clicks: "0", conversions: "0", spend_cny: "0", revenue_cny: "0" },
    ]);

    expect(summary.engagements).toBe(100);
    expect(summary.engagementRate).toBe(100 / 900);
    expect(summary.completionRate).toBe(400 / 900);
    expect(summary.clickRate).toBe(80 / 1100);
    expect(summary.roas).toBe(5);
  });

  it("rejects package, variant, or account relations outside the workspace", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: input.packageId }] })
      .mockResolvedValueOnce({ rows: [] });

    const error = await validateMetricRelations({ query } as never, "workspace-1", input);

    expect(error).toEqual({ code: "variant_not_found", message: "内容版本不存在、平台不匹配或不属于当前内容包" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("validates all metric relations before accepting a row", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: input.packageId }] })
      .mockResolvedValueOnce({ rows: [{ id: input.variantId }] })
      .mockResolvedValueOnce({ rows: [{ id: "33333333-3333-4333-8333-333333333333" }] });

    await expect(validateMetricRelations({ query } as never, "workspace-1", input)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("persists the latest insight and returns the weighted result", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ impressions: "100", views: "80", completions: "40", likes: "10", comments: "5", shares: "5", saves: "0", clicks: "8", conversions: "2", spend_cny: "10", revenue_cny: "50" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "insight-1" }] });

    const insight = await persistContentInsight({ query } as never, input.packageId);

    expect(insight.metrics.engagements).toBe(20);
    expect(insight.metrics.engagementRate).toBe(0.25);
    expect(insight.metrics.roas).toBe(5);
    expect(buildInsightSummary(insight.metrics)).toContain("互动率 25.00%");
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2]?.[0] ?? "").toContain("insert into content_insights");
  });
});
