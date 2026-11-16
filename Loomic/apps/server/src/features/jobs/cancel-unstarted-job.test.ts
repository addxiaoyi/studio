import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { cancelUnstartedJob } from "./cancel-unstarted-job.js";

function database(status: string) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("select status")) return { rows: [{
        status,
        attempt_count: status === "running" ? 1 : 0,
        workspace_id: "workspace-1",
        credits_cost: 4,
        credits_transaction_id: "debit-1",
        started_at: status === "running" ? new Date() : null,
        provider_result: null,
        cancel_requested_at: null,
      }] };
      if (sql.startsWith("select balance")) return { rows: [{ balance: "96" }] };
      if (sql.startsWith("select id,workspace_id")) return { rows: [{ id: "debit-1", workspace_id: "workspace-1",
        user_id: "user-1", transaction_type: "generation_deduct", amount: "-4" }] };
      if (sql.startsWith("update credit_balances")) return { rows: [{ balance: "100" }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client), client } as unknown as Pool & { client: typeof client };
}

describe("cancel generation job", () => {
  it("requests cancellation for a running task without refunding reserved credits", async () => {
    const db = database("running");

    await expect(cancelUnstartedJob(db, "job-1", "user-1")).resolves.toMatchObject({
      workspaceId: "workspace-1",
      amount: 0,
      cancelRequested: true,
    });
    const statements = db.client.query.mock.calls.map(([sql]) => sql);
    expect(statements.some(sql => sql.includes("cancel_requested_at=coalesce"))).toBe(true);
    expect(statements).toContain("commit");
    expect(statements.some(sql => sql.includes("status='canceled'"))).toBe(false);
  });

  it("commits a queued cancellation with its refund", async () => {
    const db = database("queued");

    await expect(cancelUnstartedJob(db, "job-1", "user-1")).resolves.toMatchObject({
      workspaceId: "workspace-1",
      amount: 4,
      cancelRequested: false,
    });
    expect(db.client.query.mock.calls.some(([sql]) => sql.includes("status='canceled'"))).toBe(true);
    const statements = db.client.query.mock.calls.map(([sql]) => sql);
    expect(statements.findIndex(sql => sql.startsWith("insert into credit_transactions"))).toBeLessThan(statements.indexOf("commit"));
  });
});
