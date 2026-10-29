import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { JOB_PAYLOAD_RETENTION_BATCH_SIZE, purgeExpiredJobPayloads } from "./job-retention.js";

function createDb(returned: Array<{ id: string }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: returned, rowCount: returned.length };
    },
  } as unknown as Pool;
  return { db, calls };
}

describe("job payload retention", () => {
  it("clears payload only on finished rows and marks them so the sweep stops rescanning", async () => {
    const { db, calls } = createDb([{ id: "job-1" }, { id: "job-2" }]);
    const result = await purgeExpiredJobPayloads({ db, log: { info: vi.fn(), error: vi.fn() } });

    expect(result.purged).toBe(2);
    const sql = calls[0]!.sql;
    expect(sql).toContain("set payload = '{}'::jsonb");
    expect(sql).toContain("payload_purged_at = now()");
    expect(sql).toContain("payload_purged_at is null");
  });

  it("never touches failed or retryable rows", async () => {
    const { db, calls } = createDb([]);
    await purgeExpiredJobPayloads({ db, log: { info: vi.fn(), error: vi.fn() } });
    const sql = calls[0]!.sql;
    expect(sql).toContain("status in ('succeeded', 'canceled')");
    expect(sql).not.toContain("'failed'");
    expect(sql).not.toContain("dead_letter");
  });

  it("clamps the batch size and retention window", async () => {
    const { db, calls } = createDb([]);
    await purgeExpiredJobPayloads({ db, retentionDays: 0, batchSize: 10_000, log: { info: vi.fn(), error: vi.fn() } });
    expect(calls[0]!.params).toEqual([1, JOB_PAYLOAD_RETENTION_BATCH_SIZE]);
  });

  it("stays quiet when nothing is due", async () => {
    const { db } = createDb([]);
    const info = vi.fn();
    const result = await purgeExpiredJobPayloads({ db, log: { info, error: vi.fn() } });
    expect(result.purged).toBe(0);
    expect(info).not.toHaveBeenCalled();
  });
});
