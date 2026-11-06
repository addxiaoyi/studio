export type VideoExportInput = {
  format: "portrait" | "landscape";
  clips: Array<{ name: string; mimeType: "video/mp4" | "video/webm"; bytes: ArrayBuffer; startMs: number; endMs: number }>;
  captions?: Array<{ text: string; startMs: number; endMs: number }>;
  audio?: Array<{ name: string; mimeType: string; bytes: ArrayBuffer; startMs: number; volume: number }>;
};

const MAX_CLIPS = 20;
const MAX_BYTES = 250 * 1024 * 1024;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const AUDIO_MIMES = new Map([["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/ogg", "ogg"], ["audio/mp4", "mov"]]);

export function parseVideoExportInput(input: unknown): VideoExportInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid video export request.");
  const value = input as Record<string, unknown>;
  if (value.captions !== undefined && (!Array.isArray(value.captions) || value.captions.length > 100)) throw new Error("Invalid caption layers.");
  if (value.audio !== undefined && !Array.isArray(value.audio)) throw new Error("Invalid audio layers.");
  if (value.format !== "portrait" && value.format !== "landscape") throw new Error("Invalid export format.");
  if (!Array.isArray(value.clips) || value.clips.length < 1 || value.clips.length > MAX_CLIPS) throw new Error("Select between 1 and 20 video clips.");
  let totalBytes = 0;
  let totalDuration = 0;
  const clips: VideoExportInput["clips"] = value.clips.map((item: unknown): VideoExportInput["clips"][number] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid video clip.");
    const clip = item as Record<string, unknown>;
    if (typeof clip.name !== "string" || !clip.name.trim() || clip.name.length > 200) throw new Error("Invalid video clip name.");
    if (clip.mimeType !== "video/mp4" && clip.mimeType !== "video/webm") throw new Error("Only MP4 and WebM videos are supported.");
    if (!(clip.bytes instanceof ArrayBuffer) || clip.bytes.byteLength === 0) throw new Error("Video clip is empty.");
    if (!Number.isSafeInteger(clip.startMs) || !Number.isSafeInteger(clip.endMs) || (clip.startMs as number) < 0 || (clip.endMs as number) <= (clip.startMs as number) || (clip.endMs as number) > MAX_DURATION_MS) throw new Error("Invalid video clip range.");
    totalBytes += clip.bytes.byteLength;
    totalDuration += (clip.endMs as number) - (clip.startMs as number);
    return { name: clip.name.replace(/[\u0000-\u001f\u007f]/g, " "), mimeType: clip.mimeType, bytes: clip.bytes, startMs: clip.startMs as number, endMs: clip.endMs as number };
  });
  const audioValues = Array.isArray(value.audio) ? value.audio : [];
  if (audioValues.length > 8) throw new Error("Too many background audio tracks.");
  if (totalBytes > MAX_BYTES) throw new Error("The combined media size exceeds 250 MB.");
  if (totalDuration > MAX_DURATION_MS) throw new Error("The video duration exceeds two hours.");
  const captions = Array.isArray(value.captions) ? value.captions.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).text !== "string") throw new Error("Invalid caption.");
    const caption = item as Record<string, unknown>;
    if (!String(caption.text).trim() || String(caption.text).length > 500 || !Number.isSafeInteger(caption.startMs) || !Number.isSafeInteger(caption.endMs) || Number(caption.startMs) < 0 || Number(caption.endMs) <= Number(caption.startMs) || Number(caption.endMs) > totalDuration) throw new Error("Invalid caption range.");
    return { text: String(caption.text).slice(0, 500), startMs: Number(caption.startMs), endMs: Number(caption.endMs) };
  }) : undefined;
  const audio = Array.isArray(value.audio) ? value.audio.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid audio asset.");
    const audio = item as Record<string, unknown>;
    if (typeof audio.name !== "string" || !audio.name.trim() || typeof audio.mimeType !== "string" || !AUDIO_MIMES.has(audio.mimeType) || !(audio.bytes instanceof ArrayBuffer) || !audio.bytes.byteLength || !Number.isSafeInteger(audio.startMs) || Number(audio.startMs) < 0 || Number(audio.startMs) >= totalDuration || typeof audio.volume !== "number" || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 2) throw new Error("Invalid audio asset.");
    totalBytes += audio.bytes.byteLength;
    return { name: audio.name.replace(/[\u0000-\u001f\u007f]/g, " "), mimeType: audio.mimeType, bytes: audio.bytes, startMs: Number(audio.startMs), volume: audio.volume };
  }) : undefined;
  if (totalBytes > MAX_BYTES) throw new Error("The combined media size exceeds 250 MB.");
  return { format: value.format, clips, ...(captions?.length ? { captions } : {}), ...(audio?.length ? { audio } : {}) };
}
