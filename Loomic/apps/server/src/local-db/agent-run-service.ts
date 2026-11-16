import { randomUUID } from "node:crypto";
import type { Pool, QueryConfig, QueryResultRow } from "pg";
import type { AgentRunMetadataService } from "../features/agent-runs/agent-run-service.js";
import type { CreateAcceptedAgentRunInput, UpdateAgentRunInput } from "../features/agent-runs/types.js";

const LEASE_MS = 45_000;
const RENEW_MS = 10_000;
const QUERY_TIMEOUT_MS = 5000;

function leaseQuery<Row extends QueryResultRow = QueryResultRow>(db: Pool, query: QueryConfig) {
  const timed = { ...query, query_timeout: QUERY_TIMEOUT_MS };
  return db.query<Row>(timed);
}

export async function recoverExpiredAgentRuns(db: Pool): Promise<number> {
  const recovery = await leaseQuery(db, {
    text: `update agent_runs set status='failed',completed_at=now(),error_code='run_interrupted',
           error_message='执行实例已断开，请检查已保存的对话和产物后继续。',run_lease_until=null
           where status in ('accepted','running') and run_owner is not null and run_lease_until<=now()`,
  });
  return recovery.rowCount ?? 0;
}

type LeaseOptions = { onLeaseLost?(runId: string): void };
type LocalRunMetadata = AgentRunMetadataService & { renewLeases(): Promise<void>; close(): Promise<void> };

export function createLocalAgentRunMetadataService(db: Pool, options: LeaseOptions = {}): LocalRunMetadata {
  const owner = randomUUID();
  const active = new Map<string, ReturnType<typeof setTimeout>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let renewal: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  function forget(runId: string) {
    clearTimeout(active.get(runId));
    active.delete(runId);
    if (!active.size && timer) { clearInterval(timer); timer = undefined; }
  }

  function lost(runId: string) {
    if (!active.has(runId)) return;
    forget(runId);
    console.error("[agent-run-lease] execution ownership lost", { runId });
    options.onLeaseLost?.(runId);
  }

  function watch(runId: string, leaseStart: number) {
    clearTimeout(active.get(runId));
    const watchdog = setTimeout(() => lost(runId), Math.max(0, LEASE_MS - (Date.now() - leaseStart)));
    watchdog.unref();
    active.set(runId, watchdog);
    timer ??= setInterval(() => { void renewLeases().catch(error => console.error("[agent-run-lease] renewal failed", error)); }, RENEW_MS);
    timer.unref();
  }

  function renewLeases(): Promise<void> {
    if (renewal) return renewal;
    if (!active.size || closing) return Promise.resolve();
    const ids = [...active.keys()];
    const leaseStart = Date.now();
    renewal = (async () => {
      const updated = await leaseQuery<{ id: string }>(db, {
        text: `update agent_runs set run_lease_until=now()+make_interval(secs=>$3)
               where id=any($1::uuid[]) and run_owner=$2 and run_lease_until>now()
               and status in ('accepted','running') returning id`,
        values: [ids, owner, LEASE_MS / 1000],
      });
      const kept = new Set(updated.rows.map(row => row.id));
      for (const id of ids) {
        if (!active.has(id)) continue;
        if (kept.has(id)) watch(id, leaseStart);
        else lost(id);
      }
    })().finally(() => { renewal = undefined; });
    return renewal;
  }

  return {
    renewLeases,
    async createAcceptedRun(input: CreateAcceptedAgentRunInput) {
      if (closing) throw new Error("Agent run metadata is closing");
      const started = Date.now();
      await leaseQuery(db, { text: `insert into agent_runs(id,session_id,thread_id,status,model,run_owner,run_lease_until)
        values($1,$2,$3,'accepted',$4,$5,now()+make_interval(secs=>$6))`,
        values: [input.runId,input.sessionId,input.threadId,input.model ?? null,owner,LEASE_MS / 1000] });
      watch(input.runId, started);
    },
    async updateRun(input: UpdateAgentRunInput) {
      const terminal = input.status === "completed" || input.status === "failed";
      const updated = await leaseQuery(db, {
        text: `update agent_runs set status=$1,completed_at=coalesce($2,completed_at),error_code=coalesce($3,error_code),
          error_message=coalesce($4,error_message),run_lease_until=case when $7 then null else run_lease_until end
          where id=$5 and run_owner=$6 and (run_lease_until>now() or (status=$1 and $7)) returning id`,
        values: [input.status,input.completedAt ?? null,input.errorCode ?? null,input.errorMessage ?? null,input.runId,owner,terminal],
      });
      if (!updated.rowCount) {
        lost(input.runId);
        throw new Error("Agent run lease expired or belongs to another execution instance");
      }
      if (terminal) forget(input.runId);
    },
    close() {
      closing ??= (async () => {
        clearInterval(timer);
        await renewal;
        const ids = [...active.keys()];
        for (const id of ids) forget(id);
        if (!ids.length) return;
        await leaseQuery(db, { text: `update agent_runs set status='failed',completed_at=now(),error_code='run_interrupted',
          error_message='服务已切换，请从已保存的对话继续。',run_lease_until=null
          where id=any($1::uuid[]) and run_owner=$2 and status in ('accepted','running')`,
          values: [ids,owner] });
      })();
      return closing;
    },
  };
}
