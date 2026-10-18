import { describe, expect, it, vi } from "vitest";

import { processDuePublishingPlans } from "./publishing-scheduler.js";

function buildDb(query: ReturnType<typeof vi.fn>) {
  return { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) };
}

describe("publishing scheduler", () => {
  it("notifies due plans once and audits the real previous status", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: "plan-1",
        workspace_id: "workspace-1",
        created_by: "user-1",
        account_id: "account-1",
        platform: "douyin",
        account_alias: "主账号",
        scheduled_at: "2026-10-01T10:00:00.000Z",
        status: "scheduled",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const notified = await processDuePublishingPlans(
      buildDb(query) as never,
      new Date("2026-10-01T11:00:00.000Z"),
    );

    expect(notified).toBe(1);
    expect(query.mock.calls[4]?.[0]).toContain("publishing_audit_logs");
    expect(query.mock.calls[4]?.[1]).toEqual([
      "workspace-1",
      "plan-1",
      "account-1",
      "scheduled",
      JSON.stringify({ manualOnly: true }),
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
  });

  it("does not notify when another worker already claimed the plan", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: "plan-1",
        workspace_id: "workspace-1",
        created_by: "user-1",
        account_id: "account-1",
        platform: "douyin",
        account_alias: "主账号",
        scheduled_at: "2026-10-01T10:00:00.000Z",
        status: "ready",
      }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(processDuePublishingPlans(buildDb(query) as never, new Date("2026-10-01T11:00:00.000Z")))
      .resolves.toBe(0);
    expect(query).toHaveBeenCalledTimes(4);
  });
});
