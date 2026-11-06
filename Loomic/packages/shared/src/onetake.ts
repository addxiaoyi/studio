import { z } from "zod";

const time = z.number().finite().min(0).max(7200);
const range = z.strictObject({ start: time, end: time });
export const transcriptSchema = z.strictObject({
  duration: time.positive(),
  peaks: z.array(z.number().min(0).max(1)).max(2000).optional(),
  words: z.array(range.extend({ text: z.string().min(1).max(500), confidence: z.number().min(0).max(1), kind: z.enum(["normal", "filler"]) })).max(30_000),
  silences: z.array(range).max(30_000),
}).superRefine((document, context) => {
  for (const key of ["words", "silences"] as const) {
    let end = 0;
    for (const [index, item] of document[key].entries()) {
      if (item.start < end || item.end <= item.start || item.end > document.duration) {
        context.addIssue({ code: "custom", path: [key, index], message: "转写时间必须有序、互不重叠且位于素材内。" });
      }
      end = item.end;
    }
  }
});
export type Transcript = z.infer<typeof transcriptSchema>;
export const transcriptEditSchema = z.strictObject({
  words: z.array(z.strictObject({ text: z.string().min(1).max(500), deleted: z.boolean() })).max(30_000),
  silences: z.array(z.boolean()).max(30_000),
});
export type TranscriptEdit = z.infer<typeof transcriptEditSchema>;
export const transcriptOptionsSchema = z.strictObject({
  model: z.enum(["tiny", "base", "small", "medium", "large-v3"]).default("base"),
  language: z.enum(["auto", "zh", "en", "ja", "ko", "fr", "de", "es"]).default("auto"),
});
export const transcriptExportSchema = z.strictObject({
  format: z.enum(["mp4", "mov", "avi"]).default("mp4"),
  quality: z.enum(["low", "medium", "high"]).default("high"),
  aspect: z.enum(["original", "portrait", "landscape"]).default("original"),
  subtitle: z.strictObject({
    enabled: z.boolean().default(true),
    mode: z.enum(["burn", "soft"]).default("burn"),
    font: z.enum(["Noto Sans CJK SC", "Microsoft YaHei", "Arial"]).default("Noto Sans CJK SC"),
    size: z.number().int().min(16).max(72).nullable().default(null),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#ffffff"),
    outlineColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#000000"),
    outlineWidth: z.number().int().min(0).max(5).default(2),
    position: z.enum(["top", "center", "bottom"]).default("bottom"),
  }),
}).superRefine((input, context) => {
  if (input.format === "avi" && input.subtitle.enabled && input.subtitle.mode === "soft") {
    context.addIssue({ code: "custom", message: "AVI 不支持内嵌软字幕，请使用烧录字幕或 MP4/MOV。" });
  }
});
export type TranscriptExportOptions = z.infer<typeof transcriptExportSchema>;
export type TranscriptCaption = { text: string; startMs: number; endMs: number };

export function createTranscriptEdit(document: Transcript): TranscriptEdit {
  return { words: document.words.map(word => ({ text: word.text, deleted: false })), silences: document.silences.map(() => false) };
}

function timestamp(seconds: number): string {
  const millis = Math.round(seconds * 1000);
  const fields = [Math.floor(millis / 3_600_000), Math.floor(millis / 60_000) % 60, Math.floor(millis / 1000) % 60];
  return fields.map(field => String(field).padStart(2, "0")).join(":") + "," + String(millis % 1000).padStart(3, "0");
}

/** Compile only text/deletion choices; source timestamps stay server-owned. */
export function compileTranscript(document: Transcript, input: TranscriptEdit) {
  const edit = transcriptEditSchema.parse(input);
  if (edit.words.length !== document.words.length || edit.silences.length !== document.silences.length) throw new Error("转写版本已改变，请重新加载后编辑。");
  const removed = [
    ...document.words.filter((_, index) => edit.words[index]!.deleted),
    ...document.silences.filter((_, index) => edit.silences[index]),
  ].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const item of removed) {
    const last = merged.at(-1);
    if (last && last.end >= item.start) last.end = Math.max(last.end, item.end);
    else merged.push({ start: item.start, end: item.end });
  }
  const segments: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const item of merged) {
    if (item.start > cursor) segments.push({ start: cursor, end: item.start });
    cursor = item.end;
  }
  if (cursor < document.duration) segments.push({ start: cursor, end: document.duration });
  const duration = segments.reduce((sum, item) => sum + item.end - item.start, 0);
  if (duration < 0.04) throw new Error("至少保留一帧视频，请恢复部分文本或静音片段。");
  if (segments.length > 500) throw new Error("本次删减超过 500 个片段，请合并部分相邻片段后重试。");
  const captions: TranscriptCaption[] = [];
  let offset = 0;
  let wordIndex = 0;
  for (const segment of segments) {
    while (wordIndex < document.words.length && document.words[wordIndex]!.end <= segment.start) wordIndex++;
    for (let index = wordIndex; index < document.words.length; index++) {
      const word = document.words[index]!;
      if (word.start >= segment.end) break;
      if (edit.words[index]!.deleted || word.start >= segment.end || word.end <= segment.start) continue;
      const text = edit.words[index]!.text.replace(/\s+/g, " ").trim();
      if (!text) throw new Error("字幕不能全部为空白。");
      captions.push({ text, startMs: Math.round((offset + Math.max(word.start, segment.start) - segment.start) * 1000), endMs: Math.round((offset + Math.min(word.end, segment.end) - segment.start) * 1000) });
    }
    offset += segment.end - segment.start;
  }
  const srt = captions.map((caption, index) => `${index + 1}\n${timestamp(caption.startMs / 1000)} --> ${timestamp(caption.endMs / 1000)}\n${caption.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}\n`).join("\n");
  return { segments, captions, duration: Math.round(duration * 1000) / 1000, srt };
}

export type TranscriptTask = {
  id: string; name: string; mimeType: string; model: string; language: string;
  state: "queued" | "running" | "completed" | "failed" | "canceled" | "expired";
  progress: number; revision: number; error: string | null; createdAt: string; expiresAt: string;
  transcript: Transcript | null; edit: TranscriptEdit | null;
};
export type TranscriptSummary = Omit<TranscriptTask, "transcript" | "edit">;
export type TranscriptExport = {
  id: string; taskId: string; fingerprint: string;
  state: "pending" | "queued" | "running" | "completed" | "failed" | "canceled";
  progress: number; error: string | null; options: TranscriptExportOptions; duration: number;
};
