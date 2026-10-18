import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { cleanExpiredGeneratedAssets } from "./asset-retention.js";

describe("generated asset retention", () => {
  afterEach(() => vi.restoreAllMocks());

  it("soft-deletes expired assets and sends a recovery notification", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ object_id: "object-1", generated_asset_id: "asset-1", workspace_id: "workspace-1", bucket: "project-assets", object_path: "workspace-1/generated/image.png", retention_state: "active", created_by: "user-1" }] })
      .mockResolvedValue({ rows: [] });
    const storage = { remove: vi.fn() };

    const result = await cleanExpiredGeneratedAssets({ db: { query } as unknown as Pool, storage: storage as never, log: { error: vi.fn(), info: vi.fn() } });

    expect(result).toEqual({ softDeleted: 1, purged: 0, failed: 0 });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("asset_soft_deleted"))).toBe(true);
    expect(query.mock.calls.some(([, params]) => Array.isArray(params) && params.some((value) => typeof value === "string" && value.includes("asset-1")))).toBe(true);
  });

  it("marks purged state in the same transaction as metadata deletion", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ object_id: "object-1", generated_asset_id: "asset-1", workspace_id: "workspace-1", bucket: "project-assets", object_path: "workspace-1/generated/image.png", retention_state: "soft_deleted", created_by: "user-1" }] });
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const storage = { remove: vi.fn().mockResolvedValue({ error: null }) };

    const result = await cleanExpiredGeneratedAssets({ db: { query, connect } as unknown as Pool, storage: storage as never, log: { error: vi.fn(), info: vi.fn() } });

    expect(result).toEqual({ softDeleted: 0, purged: 1, failed: 0 });
    expect(clientQuery.mock.calls.map(([sql]) => String(sql))).toContainEqual(expect.stringContaining("retention_state = 'purged'"));
    const purgedIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql).includes("retention_state = 'purged'"));
    const commitIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql) === "commit");
    expect(purgedIndex).toBeGreaterThan(-1);
    expect(purgedIndex).toBeLessThan(commitIndex);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("asset_purged"))).toBe(true);
  });
});
