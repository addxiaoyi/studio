import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { cleanExpiredGeneratedAssets } from "./asset-retention.js";

describe("generated asset retention", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the cloud retention window at three days", async () => {
    const { ASSET_RETENTION_DAYS } = await import("./asset-retention.js");
    expect(ASSET_RETENTION_DAYS).toBe(3);
  });

  it("permanently removes cloud assets at their retention deadline without starting a second recovery window", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ object_id: "object-1", generated_asset_id: "asset-1", workspace_id: "workspace-1", bucket: "project-assets", object_path: "workspace-1/generated/image.png", retention_state: "active", created_by: "user-1" }] });
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const storage = { remove: vi.fn().mockResolvedValue({ error: null }) };

    const result = await cleanExpiredGeneratedAssets({ db: { query, connect } as unknown as Pool, storage: storage as never, log: { error: vi.fn(), info: vi.fn() } });

    expect(result).toEqual({ purged: 1, failed: 0 });
    expect(storage.remove).toHaveBeenCalledWith("project-assets", ["workspace-1/generated/image.png"]);
    expect(clientQuery.mock.calls.some(([sql, params]) => String(sql).includes("asset_purged") && Array.isArray(params) && params.includes("Cloud asset removed"))).toBe(true);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("retention_state = 'purged'"))).toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("ga.retention_until <= now()");
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(3);
  });

  it("marks purged state in the same transaction as metadata deletion", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ object_id: "object-1", generated_asset_id: "asset-1", workspace_id: "workspace-1", bucket: "project-assets", object_path: "workspace-1/generated/image.png", retention_state: "soft_deleted", created_by: "user-1" }] });
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const storage = { remove: vi.fn().mockResolvedValue({ error: null }) };

    const result = await cleanExpiredGeneratedAssets({ db: { query, connect } as unknown as Pool, storage: storage as never, log: { error: vi.fn(), info: vi.fn() } });

    expect(result).toEqual({ purged: 1, failed: 0 });
    expect(clientQuery.mock.calls.map(([sql]) => String(sql))).toContainEqual(expect.stringContaining("retention_state = 'purged'"));
    const purgedIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql).includes("retention_state = 'purged'"));
    const commitIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql) === "commit");
    expect(purgedIndex).toBeGreaterThan(-1);
    expect(purgedIndex).toBeLessThan(commitIndex);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("asset_purged"))).toBe(true);
  });

  it("does not delete the cloud object if storage removal fails", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ object_id: "object-1", generated_asset_id: "asset-1", workspace_id: "workspace-1", bucket: "project-assets", object_path: "workspace-1/generated/image.png", retention_state: "active", created_by: null }] });
    const connect = vi.fn();
    const storage = { remove: vi.fn().mockResolvedValue({ error: new Error("storage unavailable") }) };

    const result = await cleanExpiredGeneratedAssets({ db: { query, connect } as unknown as Pool, storage: storage as never, log: { error: vi.fn(), info: vi.fn() } });

    expect(result).toEqual({ purged: 0, failed: 1 });
    expect(connect).not.toHaveBeenCalled();
  });
});
