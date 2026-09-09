import type { Pool } from "pg";
import type { PgmqClient, PgmqMessage } from "./pgmq-client.js";

export function createLocalJobQueue(db: Pool): PgmqClient {
  return {
    async send(_queue, payload) {
      const { rows } = await db.query("update background_jobs set status = 'queued', updated_at = now() where id = $1 returning id", [payload.job_id]);
      return rows[0]?.id ?? 0;
    },
    async read(queue, _vt, qty) {
      const client = await db.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query("select id, job_type, payload, workspace_id, canvas_id, session_id from background_jobs where queue_name = $1 and status = 'queued' order by created_at for update skip locked limit $2", [queue, qty]);
        if (rows.length) await client.query("update background_jobs set status = 'running', started_at = now(), updated_at = now() where id = any($1::uuid[])", [rows.map((row) => row.id)]);
        await client.query("commit");
        return rows.map((row, index) => ({ msg_id: index + 1, read_ct: 1, enqueued_at: new Date().toISOString(), vt: new Date().toISOString(), message: { job_id: row.id, job_type: row.job_type, workspace_id: row.workspace_id, canvas_id: row.canvas_id, session_id: row.session_id, payload: row.payload } })) as PgmqMessage[];
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async readWithPoll(queue, vt, qty, maxPollSeconds = 5) { return this.read(queue, vt, qty); },
    async deleteMsg(_queue, _msgId) { return true; },
    async archive(_queue, _msgId) { return true; },
    async setVt(_queue, _msgId, _vt) {},
    async shutdown() { await db.end(); },
  };
}
