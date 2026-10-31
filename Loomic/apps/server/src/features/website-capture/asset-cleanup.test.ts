import { describe, expect, it, vi } from "vitest";

import { softDeleteWebsiteCaptureAssets } from "./asset-cleanup.js";

describe("website capture failed asset cleanup", () => {
  it("soft-deletes task assets in a transaction and leaves storage for recovery", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "asset-1" }, { id: "asset-2" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query: clientQuery, release: vi.fn() };
    const db = { connect: vi.fn().mockResolvedValue(client) };

    await expect(softDeleteWebsiteCaptureAssets(db as never, "task-1")).resolves.toBe(2);

    expect(clientQuery.mock.calls[0]?.[0]).toBe("begin");
    expect(String(clientQuery.mock.calls[2]?.[0])).toContain("retention_state='soft_deleted'");
    expect(clientQuery.mock.calls[2]?.[1]?.[0]).toEqual(["asset-1", "asset-2"]);
    expect(String(clientQuery.mock.calls[3]?.[0])).toContain("update gallery_items");
    expect(clientQuery.mock.calls[4]?.[0]).toBe("commit");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back when metadata cleanup fails", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "asset-1" }] })
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ rows: [] });
    const client = { query: clientQuery, release: vi.fn() };

    await expect(softDeleteWebsiteCaptureAssets({ connect: vi.fn().mockResolvedValue(client) } as never, "task-1")).rejects.toThrow("database unavailable");
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
});
