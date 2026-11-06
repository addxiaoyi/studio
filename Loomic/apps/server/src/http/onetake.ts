import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { compileTranscript, transcriptEditSchema, transcriptExportSchema, transcriptOptionsSchema } from "@helstera/shared";
import type { AuthenticatedUser, RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { savePrivateVideo } from "../features/assets/private-video.js";
import { createTranscriptStore, publicExport, publicTranscript, publicTranscriptSummary, TranscriptError } from "../features/onetake/store.js";
import { oneTakeModels, probeOneTake } from "../features/onetake/runner.js";
import type { StorageProvider } from "../storage/storage-provider.js";

const LIMIT_BYTES = 500 * 1024 * 1024;
const types: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-msvideo": "avi", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/flac": "flac" };
const identifier = z.strictObject({ id: z.string().uuid() });
const revision = z.number().int().nonnegative();

async function streamMedia(request: FastifyRequest, reply: FastifyReply, path: string, mime: string, name: string, attachment = false) {
  const info = await stat(path);
  const range = request.headers.range;
  reply.header("Cache-Control", "private, no-store").header("Accept-Ranges", "bytes").header("Content-Type", mime);
  reply.header("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(name))}`);
  if (!range) return reply.header("Content-Length", info.size).send(createReadStream(path));
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  const start = match ? Number(match[1]) : NaN;
  const end = match?.[2] ? Number(match[2]) : info.size - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start >= info.size || !Number.isSafeInteger(end) || end < start || end >= info.size) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
  return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${info.size}`).header("Content-Length", end - start + 1).send(createReadStream(path, { start, end }));
}

export function registerOneTakeRoutes(app: FastifyInstance, options: {
  auth: RequestAuthenticator; viewerService: ViewerService; db: Pool; storageRoot: string; storage: StorageProvider;
  probe?: typeof probeOneTake;
}) {
  const store = createTranscriptStore(options.db);
  const users = new WeakMap<FastifyRequest, AuthenticatedUser>();
  const user = (request: FastifyRequest) => users.get(request)!;
  let uploads = 0;
  let capability: { expires: number; value: Awaited<ReturnType<typeof probeOneTake>> } | undefined;
  void app.register(async scope => {
    scope.addHook("onRequest", async (request, reply) => {
      const actor = await options.auth.authenticate(request);
      if (!actor) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录工作区。" } });
      users.set(request, actor);
    });
    scope.setErrorHandler((error, request, reply) => {
      if (error instanceof TranscriptError) return reply.code(error.status).send({ ok: false, error: { code: "transcript_conflict", message: error.message } });
      if (error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError")) return reply.code(400).send({ ok: false, error: { code: "invalid_transcript", message: "文本、时间或导出选项无效，请检查后重试。" } });
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ ok: false, error: { code: "media_too_large", message: "素材不能超过 500 MB。" } });
      request.log.error({ err: error }, "OneTake request failed");
      return reply.code(500).send({ ok: false, error: { code: "transcript_unavailable", message: "文字剪辑服务暂不可用。素材与已保存的编辑仍保留，请重试。" } });
    });
    scope.get("/capabilities", async () => {
      if (!capability || capability.expires < Date.now()) capability = { expires: Date.now() + 30_000, value: await (options.probe ?? probeOneTake)() };
      return { ok: true, ...capability.value, models: oneTakeModels(), maxBytes: LIMIT_BYTES, maxDuration: 7200, retentionDays: 3, credits: 0 };
    });
    scope.get("/tasks", async request => ({ ok: true, tasks: (await store.list(user(request).id)).map(publicTranscriptSummary) }));
    scope.get("/tasks/:id", async request => {
      const { id } = identifier.parse(request.params);
      return { ok: true, task: publicTranscript(await store.owned(user(request).id, id)) };
    });
    scope.post("/tasks", async (request, reply) => {
      const { consent: _consent, ...rawOptions } = z.strictObject({ consent: z.literal("1"), model: z.string(), language: z.string() }).parse(request.query);
      const query = transcriptOptionsSchema.parse(rawOptions);
      if (!oneTakeModels().includes(query.model)) throw new TranscriptError("当前服务器未开放这个转写模型，请选择可用模型。", 400);
      const key = z.string().uuid().parse(request.headers["idempotency-key"]);
      const available = await (options.probe ?? probeOneTake)();
      if (!available.available) throw new TranscriptError(available.reason, 503);
      if (uploads >= 2) throw new TranscriptError("正在处理其他素材上传，请稍后重试。", 429);
      uploads++;
      let directory: string | undefined;
      let persisted = false;
      let storeStarted = false;
      try {
        const actor = user(request);
        const viewer = await options.viewerService.ensureViewer(actor);
        const file = await request.file({ limits: { files: 1, fields: 0, parts: 1, fileSize: LIMIT_BYTES } });
        if (!file || !types[file.mimetype]) throw new TranscriptError("请选择 MP4、WebM、MOV、AVI 或常见音频文件。", 400);
        const root = join(options.storageRoot, "onetake");
        await mkdir(root, { recursive: true });
        directory = await mkdtemp(join(root, "upload-"));
        const path = join(directory, `source.${types[file.mimetype]}`);
        const hash = createHash("sha256");
        let size = 0;
        const digest = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
        await pipeline(file.file, digest, createWriteStream(path, { flags: "wx" }));
        if (file.file.truncated || size === 0) throw new TranscriptError("素材为空或超过 500 MB，请重新选择。", 413);
        storeStarted = true;
        const created = await store.create({ userId: actor.id, workspaceId: viewer.workspace.id, key, name: basename(file.filename).slice(0, 240), path, digest: hash.digest("hex"), mime: file.mimetype, model: query.model, language: query.language });
        persisted = created.created;
        storeStarted = false;
        return reply.code(created.created ? 201 : 200).send({ ok: true, task: publicTranscript(created.task) });
      } finally {
        uploads--;
        // An ambiguous COMMIT must never remove a source the worker may already own.
        if (directory && !persisted && !storeStarted) await rm(directory, { recursive: true, force: true });
      }
    });
    scope.put("/tasks/:id/edit", async request => {
      const { id } = identifier.parse(request.params);
      const input = z.strictObject({ revision, edit: z.unknown() }).parse(request.body);
      return { ok: true, task: publicTranscript(await store.saveEdit(user(request).id, id, input.revision, transcriptEditSchema.parse(input.edit))) };
    });
    scope.post("/tasks/:id/cancel", async request => { await store.cancel(user(request).id, identifier.parse(request.params).id); return { ok: true }; });
    scope.post("/tasks/:id/retry", async request => ({ ok: true, task: publicTranscript(await store.retry(user(request).id, identifier.parse(request.params).id)) }));
    scope.get("/tasks/:id/source", async (request, reply) => {
      const task = await store.owned(user(request).id, identifier.parse(request.params).id);
      return streamMedia(request, reply, task.source_path, task.mime_type, task.source_name);
    });
    scope.get("/tasks/:id/subtitles", async (request, reply) => {
      const task = await store.owned(user(request).id, identifier.parse(request.params).id);
      if (!task.transcript || !task.edit) throw new TranscriptError("转写尚未完成。");
      return reply.type("application/x-subrip; charset=utf-8").header("Cache-Control", "private, no-store").header("Content-Disposition", "attachment; filename=subtitles.srt").send(compileTranscript(task.transcript, task.edit).srt);
    });
    scope.get("/tasks/:id/exports", async request => ({ ok: true, exports: (await store.listExports(user(request).id, identifier.parse(request.params).id)).map(publicExport) }));
    scope.post("/tasks/:id/exports", async request => {
      const input = z.strictObject({ revision, requestKey: z.string().uuid(), options: z.unknown() }).parse(request.body);
      return { ok: true, export: publicExport(await store.prepareExport(user(request).id, identifier.parse(request.params).id, input.revision, input.requestKey, transcriptExportSchema.parse(input.options))) };
    });
    scope.post("/exports/:id/confirm", async request => {
      const input = z.strictObject({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).parse(request.body);
      return { ok: true, export: publicExport(await store.confirmExport(user(request).id, identifier.parse(request.params).id, input.fingerprint)) };
    });
    scope.post("/exports/:id/cancel", async request => { await store.cancelExport(user(request).id, identifier.parse(request.params).id); return { ok: true }; });
    scope.get("/exports/:id/file", async (request, reply) => {
      const output = await store.exported(user(request).id, identifier.parse(request.params).id);
      if (output.state !== "completed" || !output.output_path) throw new TranscriptError("视频尚未导出完成。");
      const format = output.options.format;
      return streamMedia(request, reply, output.output_path, format === "mp4" ? "video/mp4" : format === "mov" ? "video/quicktime" : "video/x-msvideo", `OneTake-${output.id}.${format}`);
    });
    scope.post("/exports/:id/save", async request => {
      const actor = user(request);
      const output = await store.exported(actor.id, identifier.parse(request.params).id);
      if (output.state !== "completed" || !output.output_path) throw new TranscriptError("视频尚未导出完成。");
      if (output.options.format !== "mp4") throw new TranscriptError("私有素材库和聊天支持 MP4；MOV/AVI 请下载保存或重新导出 MP4。", 400);
      if ((await stat(output.output_path)).size > 250 * 1024 * 1024) throw new TranscriptError("成片超过素材库 250 MB 上限，请先下载保存。", 413);
      const viewer = await options.viewerService.ensureViewer(actor);
      const saved = await savePrivateVideo(options.db, options.storage, { userId: actor.id, workspaceId: viewer.workspace.id, uploadId: output.id, bytes: await readFile(output.output_path), mimeType: "video/mp4" });
      return { ok: true, assetId: saved.assetId };
    });
  }, { prefix: "/api/video/onetake" });
}
