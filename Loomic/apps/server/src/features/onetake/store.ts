import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { compileTranscript, transcriptEditSchema, transcriptSchema, type Transcript, type TranscriptEdit, type TranscriptTask, type TranscriptSummary, type TranscriptExport, type TranscriptExportOptions } from "@helstera/shared";

export class TranscriptError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export type TranscriptRow = {
  id: string; user_id: string; workspace_id: string; source_name: string; source_path: string; source_sha256: string; mime_type: string;
  model: string; language: string; state: TranscriptTask["state"]; progress: number; revision: number;
  error: string | null; created_at: Date; expires_at: Date; transcript: Transcript | null; edit: TranscriptEdit | null;
};
export type ExportRow = {
  id: string; task_id: string; user_id: string; fingerprint: string; state: TranscriptExport["state"];
  progress: number; error: string | null; options: TranscriptExportOptions; compiled: ReturnType<typeof compileTranscript>;
  output_path: string | null; revision: number;
};
export const publicTranscriptSummary = (row: Omit<TranscriptRow, "transcript" | "edit">): TranscriptSummary => ({
  id: row.id, name: row.source_name, mimeType: row.mime_type, model: row.model, language: row.language, state: row.state,
  progress: row.progress, revision: row.revision, error: row.error, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
});
export const publicTranscript = (row: TranscriptRow): TranscriptTask => ({ ...publicTranscriptSummary(row), transcript: row.transcript, edit: row.edit });
export const publicExport = (row: ExportRow): TranscriptExport => ({ id: row.id, taskId: row.task_id, fingerprint: row.fingerprint, state: row.state, progress: row.progress, error: row.error, options: row.options, duration: row.compiled.duration });

export function createTranscriptStore(db: Pool) {
  async function owned(userId: string, id: string) {
    const query = await db.query<TranscriptRow>("select * from video_transcripts where id=$1 and user_id=$2 and expires_at>now() and state<>'expired'", [id, userId]);
    if (!query.rows[0]) throw new TranscriptError("转写任务不存在或临时素材已过期。", 404);
    return query.rows[0];
  }
  async function exported(userId: string, id: string) {
    const query = await db.query<ExportRow>("select e.* from video_transcript_exports e join video_transcripts t on t.id=e.task_id where e.id=$1 and e.user_id=$2 and t.expires_at>now() and t.state<>'expired'", [id, userId]);
    if (!query.rows[0]) throw new TranscriptError("导出记录不存在或已过期。", 404);
    return query.rows[0];
  }
  return {
    owned, exported,
    async list(userId: string) {
      return (await db.query<Omit<TranscriptRow, "transcript" | "edit">>("select id,user_id,workspace_id,source_name,source_path,source_sha256,mime_type,model,language,state,progress,revision,error,created_at,expires_at from video_transcripts where user_id=$1 and expires_at>now() and state<>'expired' order by created_at desc limit 50", [userId])).rows;
    },
    async create(input: { userId: string; workspaceId: string; key: string; name: string; path: string; digest: string; mime: string; model: string; language: string }) {
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`transcript:${input.userId}:${input.key}`]);
        const existing = (await client.query<TranscriptRow>("select * from video_transcripts where user_id=$1 and request_key=$2", [input.userId, input.key])).rows[0];
        if (existing) {
          if (existing.source_sha256 !== input.digest || existing.model !== input.model || existing.language !== input.language || existing.expires_at.getTime() <= Date.now()) throw new TranscriptError("请求编号已用于不同素材、选项或过期任务。");
          await client.query("commit");
          return { task: existing, created: false };
        }
        const inserted = await client.query<TranscriptRow>(`insert into video_transcripts(user_id,workspace_id,request_key,source_name,source_path,source_sha256,mime_type,model,language) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [input.userId, input.workspaceId, input.key, input.name, input.path, input.digest, input.mime, input.model, input.language]);
        await client.query("commit");
        return { task: inserted.rows[0]!, created: true };
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
    },
    async saveEdit(userId: string, id: string, revision: number, input: TranscriptEdit) {
      const task = await owned(userId, id);
      if (task.state !== "completed" || !task.transcript) throw new TranscriptError("请等待转写完成。");
      const edit = transcriptEditSchema.parse(input);
      try { compileTranscript(transcriptSchema.parse(task.transcript), edit); }
      catch (error) { throw new TranscriptError(error instanceof Error ? error.message : "文本编辑无效。", 400); }
      const saved = await db.query<TranscriptRow>("update video_transcripts set edit=$4::jsonb,revision=revision+1,updated_at=now() where id=$1 and user_id=$2 and revision=$3 and state='completed' and expires_at>now() returning *", [id, userId, revision, JSON.stringify(edit)]);
      if (!saved.rows[0]) throw new TranscriptError("另一窗口已修改这份文本，请重新加载后编辑。");
      return saved.rows[0];
    },
    async cancel(userId: string, id: string) {
      await owned(userId, id);
      await db.query("update video_transcripts set state='canceled',updated_at=now() where id=$1 and user_id=$2 and state in ('queued','running')", [id, userId]);
    },
    async retry(userId: string, id: string) {
      await owned(userId, id);
      const retry = await db.query<TranscriptRow>("update video_transcripts set state='queued',error=null,progress=0,lease_token=null,lease_until=null,updated_at=now() where id=$1 and user_id=$2 and state in ('failed','canceled') and (lease_until is null or lease_until<now()) returning *", [id, userId]);
      if (!retry.rows[0]) throw new TranscriptError("该任务不能重试。");
      return retry.rows[0];
    },
    async prepareExport(userId: string, id: string, revision: number, key: string, options: TranscriptExportOptions) {
      const task = await owned(userId, id);
      if (task.state !== "completed" || task.revision !== revision || !task.transcript || !task.edit) throw new TranscriptError("文本已经改变或转写未完成，请重新预览。");
      if (!task.mime_type.startsWith("video/")) throw new TranscriptError("音频素材可下载字幕；视频导出需要视频素材。", 400);
      const compiled = compileTranscript(task.transcript, task.edit);
      const fingerprint = createHash("sha256").update(JSON.stringify({ task: id, digest: task.source_sha256, revision, options, compiled })).digest("hex");
      const inserted = await db.query<ExportRow>(`insert into video_transcript_exports(task_id,user_id,request_key,revision,fingerprint,options,compiled)
        values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) on conflict(user_id,request_key) do update set request_key=excluded.request_key
        where video_transcript_exports.fingerprint=excluded.fingerprint returning *`, [id, userId, key, revision, fingerprint, JSON.stringify(options), JSON.stringify(compiled)]);
      if (!inserted.rows[0]) throw new TranscriptError("此导出请求编号已绑定不同参数。");
      return inserted.rows[0];
    },
    async confirmExport(userId: string, id: string, fingerprint: string) {
      const confirmed = await db.query<ExportRow>(`update video_transcript_exports e set state='queued',confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
        from video_transcripts t where e.id=$1 and e.user_id=$2 and e.fingerprint=$3 and e.task_id=t.id
        and e.state in ('pending','queued') and e.expires_at>now() and t.expires_at>now() and t.state='completed' and t.revision=e.revision returning e.*`, [id, userId, fingerprint]);
      if (confirmed.rows[0]) return confirmed.rows[0];
      const previous = await exported(userId, id);
      if (previous.fingerprint === fingerprint && ["running", "completed"].includes(previous.state)) return previous;
      throw new TranscriptError("导出审批已过期或参数已改变，请重新预览。");
    },
    async cancelExport(userId: string, id: string) {
      await exported(userId, id);
      await db.query("update video_transcript_exports set state='canceled',updated_at=now() where id=$1 and user_id=$2 and state in ('pending','queued','running')", [id, userId]);
    },
    async listExports(userId: string, id: string) {
      await owned(userId, id);
      return (await db.query<ExportRow>("select * from video_transcript_exports where user_id=$1 and task_id=$2 order by created_at desc limit 30", [userId, id])).rows;
    },
  };
}
export type TranscriptStore = ReturnType<typeof createTranscriptStore>;
