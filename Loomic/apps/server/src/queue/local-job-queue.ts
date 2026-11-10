import type { Pool } from "pg";
import type { PgmqClient, PgmqMessage } from "./pgmq-client.js";
import { approvalBillingReady } from "../local-db/job-billing-gate.js";
import { setTimeout as delay } from "node:timers/promises";

export function createLocalJobQueue(db: Pool): PgmqClient {
  let closed = false;
  const stop = new AbortController();
  return {
    async send(_queue, payload) {
      const { rows } = await db.query("update background_jobs set status = 'queued', updated_at = now() where id = $1 returning id", [payload.job_id]);
      return rows[0]?.id ?? 0;
    },
    async read<T = Record<string, unknown>>(queue: string, _vt: number, qty: number): Promise<PgmqMessage<T>[]> {
      if (closed) return [];
      const client = await db.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query(`select id, job_type, payload, workspace_id, canvas_id, session_id, attempt_count, max_attempts from background_jobs where queue_name = $1 and status = 'queued' and ${approvalBillingReady} order by created_at for update skip locked limit $2`, [queue, qty]);
        await client.query("commit");
        if (closed) return [];
        return rows.map((row, index) => ({ msg_id: index + 1, read_ct: 1, enqueued_at: new Date().toISOString(), vt: new Date().toISOString(), message: { job_id: row.id, job_type: row.job_type, workspace_id: row.workspace_id, canvas_id: row.canvas_id, session_id: row.session_id, payload: row.payload, attempt_count: Number(row.attempt_count ?? 0), max_attempts: Number(row.max_attempts ?? 3) } })) as unknown as PgmqMessage<T>[];
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async readWithPoll<T = Record<string, unknown>>(queue: string, vt: number, qty: number, maxPollSeconds = 5, pollIntervalMs = 500): Promise<PgmqMessage<T>[]> {
      const until=Date.now()+Math.max(0,Math.min(30,maxPollSeconds))*1000;
      const interval=Math.max(50,Math.min(5000,pollIntervalMs));
      do {
        const messages=await this.read<T>(queue,vt,qty);
        if (closed) return [];
        if (messages.length || Date.now()>=until) return messages;
        try { await delay(Math.min(interval,Math.max(0,until-Date.now())),undefined,{ signal:stop.signal }); }
        catch (error) { if (!stop.signal.aborted) throw error; }
      } while (!closed);
      return [];
    },
    async deleteMsg(_queue, _msgId) { return true; },
    async archive(_queue, _msgId) { return true; },
    async setVt(_queue, _msgId, _vt) {},
    async shutdown() {
      // Stop polls first; the worker closes the pool after executors have drained.
      closed = true;
      stop.abort();
    },
  };
}
