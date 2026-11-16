import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createLocalAgentRunMetadataService, recoverExpiredAgentRuns } from "./agent-run-service.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("Agent run ownership across API instances", () => {
  it("preserves long live runs, reaps only expired owners and refuses late writes", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (url.hostname !== "127.0.0.1") throw new Error("Explicit loopback PostgreSQL required");
    const admin = new Pool({ connectionString: url.href });
    const schema = "agent_run_lease_" + randomUUID().replaceAll("-", "");
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema},public` });
    const lost = vi.fn();
    const first = createLocalAgentRunMetadataService(db, { onLeaseLost: lost });
    const second = createLocalAgentRunMetadataService(db);
    const session = randomUUID();
    const live = randomUUID(), expired = randomUUID(), legacy = randomUUID();
    try {
      await db.query(`create table agent_runs (
        id uuid primary key,session_id uuid not null,thread_id text not null,status text not null,model text,
        created_at timestamptz not null default now(),completed_at timestamptz,error_code text,error_message text
      )`);
      await db.query(await readFile(new URL("./migrations/20261112000000_agent_run_leases.sql", import.meta.url), "utf8"));
      await first.createAcceptedRun({ runId: live, sessionId: session, threadId: "live-thread" });
      await first.updateRun({ runId: live, status: "running" });
      await second.createAcceptedRun({ runId: expired, sessionId: session, threadId: "expired-thread" });
      await db.query("update agent_runs set created_at=now()-interval '1 hour' where id in ($1,$2)", [live, expired]);
      await db.query("update agent_runs set run_lease_until=now()-interval '1 second' where id=$1", [expired]);
      await db.query("insert into agent_runs(id,session_id,thread_id,status,created_at) values($1,$2,'legacy','running',now()-interval '1 hour')", [legacy,session]);
      expect(await recoverExpiredAgentRuns(db)).toBe(1);
      const rows = (await db.query("select id,status,error_code from agent_runs")).rows;
      expect(rows.find(row => row.id === live).status).toBe("running");
      expect(rows.find(row => row.id === legacy).status).toBe("running");
      expect(rows.find(row => row.id === expired)).toMatchObject({ status: "failed", error_code: "run_interrupted" });
      await expect(second.updateRun({ runId: expired, status: "completed" })).rejects.toThrow("lease");
      await expect(second.updateRun({ runId: live, status: "completed" })).rejects.toThrow("lease");
      await first.updateRun({ runId: live, status: "completed" });
      expect((await db.query("select run_lease_until,status from agent_runs where id=$1", [live])).rows[0]).toMatchObject({ run_lease_until: null, status: "completed" });
      expect(lost).not.toHaveBeenCalled();
    } finally {
      await Promise.all([first.close?.(), second.close?.()]);
      await db.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  });

  it("renews owned runs and cancels local work if ownership expires", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (url.hostname !== "127.0.0.1") throw new Error("Explicit loopback PostgreSQL required");
    const db = new Pool({ connectionString: url.href });
    const schema = "agent_run_renew_" + randomUUID().replaceAll("-", "");
    await db.query(`create schema ${schema}`);
    const scoped = new Pool({ connectionString: url.href, options: `-c search_path=${schema},public` });
    const lost = vi.fn();
    const service = createLocalAgentRunMetadataService(scoped, { onLeaseLost: lost });
    try {
      await scoped.query("create table agent_runs(id uuid primary key,session_id uuid,thread_id text,status text,model text,completed_at timestamptz,error_code text,error_message text)");
      await scoped.query(await readFile(new URL("./migrations/20261112000000_agent_run_leases.sql", import.meta.url), "utf8"));
      const id = randomUUID();
      await service.createAcceptedRun({ runId: id, sessionId: randomUUID(), threadId: "thread" });
      const before = (await scoped.query("select run_lease_until from agent_runs where id=$1", [id])).rows[0].run_lease_until;
      await service.renewLeases();
      const after = (await scoped.query("select run_lease_until from agent_runs where id=$1", [id])).rows[0].run_lease_until;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
      await scoped.query("update agent_runs set run_lease_until=now()-interval '1 second' where id=$1", [id]);
      await service.renewLeases();
      expect(lost).toHaveBeenCalledOnce();
      expect(lost).toHaveBeenCalledWith(id);
      await expect(service.updateRun({ runId: id, status: "completed" })).rejects.toThrow("lease");
      expect(await recoverExpiredAgentRuns(scoped)).toBe(1);
    } finally {
      await service.close?.();
      await scoped.end();
      await db.query(`drop schema ${schema} cascade`);
      await db.end();
    }
  });
});
