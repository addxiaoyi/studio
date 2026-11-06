import { isAbsolute, resolve } from "node:path";

export type ExportClip = {
  sourcePath: string;
  inputFormat: "mov" | "matroska";
  startMs: number;
  endMs: number;
  hasAudio: boolean;
};
export type ExportCaption = { sourcePath: string; startMs: number; endMs: number; bitmap?: { width: number; height: number } };
export type ExportAudio = { sourcePath: string; inputFormat: "mp3" | "wav" | "ogg" | "mov"; startMs: number; volume: number };

const MAX_CLIPS = 20;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;

function isLocalPath(path: string): boolean {
  return isAbsolute(path) && !path.includes("\0") && !path.startsWith("\\\\") && !path.startsWith("//");
}

// Paths must already be resolved from user-authorized assets by the caller.
export function buildVideoExportArgs(clips: readonly ExportClip[], outputPath: string, format: "portrait" | "landscape", options: { captions?: readonly ExportCaption[]; audio?: readonly ExportAudio[] } = {}): string[] {
  if (!clips.length || clips.length > MAX_CLIPS) throw new Error(`Export requires between 1 and ${MAX_CLIPS} clips.`);
  if (format !== "portrait" && format !== "landscape") throw new Error("Export format is invalid.");
  if (!isLocalPath(outputPath)) throw new Error("Export destination must be an absolute local path.");
  let total = 0;
  for (const clip of clips) {
    if (!isLocalPath(clip.sourcePath)) throw new Error("Clip source must be an absolute local path.");
    if (clip.inputFormat !== "mov" && clip.inputFormat !== "matroska") throw new Error("Clip input format is invalid.");
    const source = resolve(clip.sourcePath);
    const destination = resolve(outputPath);
    if (process.platform === "win32" ? source.toLowerCase() === destination.toLowerCase() : source === destination) throw new Error("Export destination must not overwrite a source clip.");
    if (typeof clip.hasAudio !== "boolean") throw new Error("Clip audio metadata is invalid.");
    if (!Number.isSafeInteger(clip.startMs) || !Number.isSafeInteger(clip.endMs) || clip.startMs < 0 || clip.endMs <= clip.startMs || clip.endMs > MAX_DURATION_MS) {
      throw new Error("Clip range is invalid or exceeds the export limit.");
    }
    total += clip.endMs - clip.startMs;
  }
  if (total > MAX_DURATION_MS) throw new Error("Export duration exceeds the two-hour limit.");
  if ((options.audio?.length ?? 0) > 8 || (options.captions?.length ?? 0) > 100) throw new Error("Too many audio or caption layers.");
  for (const audio of options.audio ?? []) {
    if (!isLocalPath(audio.sourcePath) || !["mp3", "wav", "ogg", "mov"].includes(audio.inputFormat) || !Number.isSafeInteger(audio.startMs) || audio.startMs < 0 || audio.startMs >= total || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 2) throw new Error("Invalid background audio.");
  }
  for (const caption of options.captions ?? []) {
    if (!isLocalPath(caption.sourcePath) || !Number.isSafeInteger(caption.startMs) || !Number.isSafeInteger(caption.endMs) || caption.startMs < 0 || caption.endMs <= caption.startMs || caption.endMs > total) throw new Error("Invalid caption overlay.");
    if (caption.bitmap && (![caption.bitmap.width, caption.bitmap.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 4096))) throw new Error("Invalid caption bitmap dimensions.");
  }
  const [width, height] = format === "portrait" ? [720, 1280] : [1280, 720];
  const inputs = clips.flatMap((clip) => ["-protocol_whitelist", "file,pipe", "-f", clip.inputFormat, "-i", clip.sourcePath]);
  const audioInputOffset = clips.length;
  for (const audio of options.audio ?? []) inputs.push("-protocol_whitelist", "file,pipe", "-f", audio.inputFormat, "-i", audio.sourcePath);
  const captionInputOffset = clips.length + (options.audio?.length ?? 0);
  for (const caption of options.captions ?? []) {
    inputs.push("-protocol_whitelist", "file,pipe");
    if (caption.bitmap) inputs.push("-stream_loop", "-1", "-f", "rawvideo", "-pixel_format", "bgra", "-video_size", `${caption.bitmap.width}x${caption.bitmap.height}`, "-framerate", "30");
    else inputs.push("-loop", "1", "-framerate", "30", "-f", "image2");
    inputs.push("-i", caption.sourcePath);
  }
  const filters = clips.flatMap((clip, index) => {
    const start = (clip.startMs / 1000).toFixed(3);
    const end = (clip.endMs / 1000).toFixed(3);
    const duration = ((clip.endMs - clip.startMs) / 1000).toFixed(3);
    const video = `[${index}:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`;
    const audio = clip.hasAudio
      ? `[${index}:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`;
    return [video, audio];
  });
  const streams = clips.map((_, index) => `[v${index}][a${index}]`).join("");
  filters.push(`${streams}concat=n=${clips.length}:v=1:a=1[basev][basea]`);
  let videoLabel = "basev";
  for (const [index, caption] of (options.captions ?? []).entries()) {
    const start = (caption.startMs / 1000).toFixed(3);
    const end = (caption.endMs / 1000).toFixed(3);
    const next = `caption${index}`;
    filters.push(`[${videoLabel}][${captionInputOffset + index}:v]overlay=0:0:shortest=1:enable='gte(t,${start})*lt(t,${end})'[${next}]`);
    videoLabel = next;
  }
  let audioLabel = "basea";
  for (const [index, audio] of (options.audio ?? []).entries()) {
    const next = `audio${index}`;
    const delay = Math.max(0, Math.round(audio.startMs));
    filters.push(`[${audioInputOffset + index}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delay}|${delay},volume=${audio.volume}[music${index}]`);
    filters.push(`[${audioLabel}][music${index}]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[${next}]`);
    audioLabel = next;
  }
  return ["-hide_banner", "-nostdin", "-n", ...inputs, "-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-c:v", "libx264", "-preset", "medium", "-c:a", "aac", "-movflags", "+faststart", outputPath];
}
