import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Pool } from "pg";
import { createTranscriptEdit, transcriptSchema } from "@helstera/shared";
import { runOneTake } from "./runner.js";
import type { ExportRow, TranscriptRow } from "./store.js";

type Claimed = { kind: "transcript"; row: TranscriptRow; token: string } | { kind: "export"; row: ExportRow & { source_path: string }; token: string };
type Runner = typeof runOneTake;

export async function claimTranscriptWork(db: Pool): Promise<Claimed | null> {
  const token = randomUUID();
  const exported = await db.query<ExportRow & { source_path: string }>(`with candidate as (
    select e.id,t.source_path from video_transcript_exports e join video_transcripts t on t.id=e.task_id
    where (e.state='queued' or (e.state='running' and e.lease_until<now())) and t.expires_at>now() and t.state='completed' and e.confirmed_at is not null
    order by e.created_at for update of e,t skip locked limit 1
  ) update video_transcript_exports e set state='running',progress=10,lease_token=$1,lease_until=now()+interval '90 seconds',updated_at=now()
    from candidate c where e.id=c.id returning e.*,c.source_path`, [token]);
  if (exported.rows[0]) return { kind: "export", row: exported.rows[0], token };
  const transcript = await db.query<TranscriptRow>(`with candidate as (
    select id from video_transcripts where (state='queued' or (state='running' and lease_until<now())) and expires_at>now()
    order by created_at for update skip locked limit 1
  ) update video_transcripts t set state='running',progress=10,lease_token=$1,lease_until=now()+interval '90 seconds',updated_at=now()
    from candidate c where t.id=c.id returning t.*`, [token]);
  return transcript.rows[0] ? { kind: "transcript", row: transcript.rows[0], token } : null;
}

export async function performTranscriptWork(db: Pool, work: Claimed, runner: Runner = runOneTake, stopped?: AbortSignal) {
  const table = work.kind === "export" ? "video_transcript_exports" : "video_transcripts";
  const controller = new AbortController();
  const stop = () => controller.abort();
  stopped?.addEventListener("abort", stop, { once: true });
  if (stopped?.aborted) stop();
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const kept = await db.query(`update ${table} set lease_until=now()+interval '90 seconds',updated_at=now() where id=$1 and lease_token=$2 and state='running' and lease_until>now() returning id`, [work.row.id, work.token]);
      if (!kept.rowCount) controller.abort();
    } catch (error) { console.error("[onetake] lease renewal failed", error); controller.abort(); }
    finally { heartbeatBusy = false; }
  }, 2000);
  let scratch: string | undefined;
  try {
    if (work.kind === "transcript") {
      const transcript = transcriptSchema.parse(await runner({ operation: "transcribe", source: work.row.source_path, model: work.row.model, language: work.row.language }, controller.signal));
      await db.query(`update video_transcripts set state='completed',progress=100,transcript=$3::jsonb,edit=$4::jsonb,error=null,lease_token=null,lease_until=null,updated_at=now()
        where id=$1 and lease_token=$2 and state='running' and lease_until>now() and expires_at>now()`, [work.row.id, work.token, JSON.stringify(transcript), JSON.stringify(createTranscriptEdit(transcript))]);
    } else {
      scratch = join(dirname(work.row.source_path), `export-${work.row.id}-${work.token}`);
      await mkdir(scratch, { recursive: false });
      const output = join(scratch, `video.${work.row.options.format}`);
      await runner({ operation: "export", source: work.row.source_path, output, options: work.row.options, compiled: work.row.compiled }, controller.signal);
      const final = join(dirname(work.row.source_path), `${work.row.id}-${work.token}.${work.row.options.format}`);
      await rename(output, final);
      const saved = await db.query(`update video_transcript_exports set state='completed',progress=100,output_path=$3,error=null,lease_token=null,lease_until=null,updated_at=now()
        where id=$1 and lease_token=$2 and state='running' and lease_until>now() returning id`, [work.row.id, work.token, final]);
      if (!saved.rowCount) await rm(final, { force: true });
    }
  } catch (error) {
    console.error(`[onetake] ${work.kind} ${work.row.id} failed`, error);
    const message = work.kind === "transcript" ? "转写未完成，请检查素材音轨与转写模型后重试。原素材仍保留。" : "导出未完成，请检查字幕渲染环境或重新预览导出。原素材与编辑仍保留。";
    await db.query(`update ${table} set state=$3,error=$4,lease_token=null,lease_until=null,updated_at=now() where id=$1 and lease_token=$2 and state='running'`, [work.row.id, work.token, controller.signal.aborted ? "queued" : "failed", controller.signal.aborted ? null : message]);
  } finally {
    clearInterval(heartbeat);
    stopped?.removeEventListener("abort", stop);
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(error => console.error("[onetake] scratch cleanup failed", error));
    await db.query(`update ${table} set lease_token=null,lease_until=null where id=$1 and lease_token=$2 and state='canceled'`, [work.row.id, work.token]);
  }
}

export async function expireTranscripts(db: Pool, storageRoot: string) {
  // Expired rows remain eligible until deletion succeeds, including after a restart.
  const expired = await db.query<{ id: string; source_path: string }>(`with candidates as (
    select t.id from video_transcripts t where t.expires_at<=now() and t.cleaned_at is null and (t.lease_until is null or t.lease_until<now())
    and not exists(select 1 from video_transcript_exports e where e.task_id=t.id and e.lease_until>now())
    for update of t skip locked
  ) update video_transcripts t set state='expired',transcript=null,edit=null,updated_at=now() from candidates c where t.id=c.id returning t.id,t.source_path`);
  const root = resolve(storageRoot, "onetake");
  for (const row of expired.rows) {
    const directory = resolve(dirname(row.source_path));
    const local = relative(root, directory);
    if (!local || local.startsWith("..") || local.includes(":") || local.split(sep).length !== 1 || !local.startsWith("upload-")) throw new Error("Refusing to clean an unrecognized OneTake directory.");
    try {
      await rm(directory, { recursive: true, force: true });
      await db.query("update video_transcript_exports set state=case when state='completed' then state else 'canceled' end,output_path=null,lease_token=null,lease_until=null where task_id=$1", [row.id]);
      await db.query("update video_transcripts set cleaned_at=now() where id=$1 and state='expired'", [row.id]);
    } catch (error) { console.error(`[onetake] expired source cleanup will retry: ${row.id}`, error); }
  }
}

export function startOneTakeWorker(db: Pool, storageRoot: string) {
  const controller = new AbortController();
  let current: Promise<void> | undefined;
  let lastCleanup = 0;
  const cycle = async () => {
    if (current || controller.signal.aborted) return;
    current = (async () => {
      if (Date.now() - lastCleanup > 60_000) { await expireTranscripts(db, storageRoot); lastCleanup = Date.now(); }
      const work = await claimTranscriptWork(db);
      if (work) await performTranscriptWork(db, work, runOneTake, controller.signal);
    })();
    try { await current; }
    catch (error) { console.error("[onetake] worker cycle failed", error); }
    finally { current = undefined; }
  };
  const timer = setInterval(() => { void cycle(); }, 2000);
  timer.unref();
  void cycle();
  return async () => { clearInterval(timer); controller.abort(); await current; };
}
