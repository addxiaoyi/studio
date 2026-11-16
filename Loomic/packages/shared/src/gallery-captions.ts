export const MAX_GALLERY_CAPTION_BYTES = 256 * 1024;
const MAX_CUES = 2000;
const MAX_DURATION_MS = 7_200_000;

export type GalleryCaptionCue = {
  startMs: number;
  endMs: number;
  text: string;
};
export type GalleryCaptionInput = {
  vtt: string;
  language: string;
  label: string;
  consent: true;
};
export type GalleryCaptionSnapshot = {
  version: 1;
  language: string;
  label: string;
  cues: GalleryCaptionCue[];
};

function captionTime(value: string): number {
  const match = /^(?:(\d{2}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match)
    throw new Error("字幕时间须使用 00:00:00.000 或 00:00.000 格式。");
  return (
    (Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
      1000 +
    Number(match[4])
  );
}

export function parseGalleryCaptions(
  input: GalleryCaptionInput,
): GalleryCaptionSnapshot {
  if (input.consent !== true) throw new Error("请确认将所选字幕一并公开。");
  const label = input.label.trim();
  if (!label || label.length > 60) throw new Error("字幕名称须为 1–60 字。");
  if (!/^(?:[a-z]{2,3})(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(input.language))
    throw new Error("请选择有效的字幕语言。");
  const bytes = Array.from(input.vtt).reduce((size, character) => {
    const point = character.codePointAt(0) ?? 0;
    return (
      size + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4)
    );
  }, 0);
  if (bytes > MAX_GALLERY_CAPTION_BYTES)
    throw new Error("字幕文件不能超过 256 KB。");
  const source = input.vtt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const blocks = source.split(/\n[ \t]*\n/);
  if (blocks.shift() !== "WEBVTT")
    throw new Error("请选择以 WEBVTT 开头的纯文本 .vtt 字幕。");
  if (!blocks.length || blocks.length > MAX_CUES)
    throw new Error("字幕须包含 1–2000 个字幕片段。");
  let previousEnd = 0;
  const cues = blocks.map((block) => {
    const lines = block.split("\n");
    if (!lines[0]?.includes(" --> ")) lines.shift();
    const timing = lines.shift();
    const match = timing && /^(\S+) --> (\S+)$/.exec(timing);
    if (!match)
      throw new Error("字幕片段时间无效；暂不支持 STYLE、REGION 或定位设置。");
    const startMs = captionTime(match[1] ?? "");
    const endMs = captionTime(match[2] ?? "");
    const text = lines.join("\n").trim();
    if (startMs < previousEnd || endMs <= startMs || endMs > MAX_DURATION_MS)
      throw new Error("字幕时间必须有序、不重叠且在两小时内。");
    if (
      !text ||
      text.length > 2000 ||
      [...text].some(
        (character) =>
          character.charCodeAt(0) < 32 &&
          character !== "\n" &&
          character !== "\t",
      )
    )
      throw new Error("每段字幕须为 1–2000 字的纯文本。");
    previousEnd = endMs;
    return { startMs, endMs, text };
  });
  return { version: 1, language: input.language, label, cues };
}

function timestamp(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function galleryCaptionsVtt(snapshot: GalleryCaptionSnapshot): string {
  return `WEBVTT\n\n${snapshot.cues.map((cue, index) => `${index + 1}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}\n`).join("\n")}`;
}
