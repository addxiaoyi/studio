import type { MessageBoxOptions } from "electron";
import type { VideoExportInput } from "./video-export-request.js";

export function videoExportConfirmation(request: VideoExportInput, directory: string): MessageBoxOptions {
  const detail = request.clips.map((clip, index) => `${index + 1}. ${clip.name} (${(clip.startMs / 1000).toFixed(1)}s - ${(clip.endMs / 1000).toFixed(1)}s)`).join("\n");
  const layers = [
    ...(request.captions ?? []).map(caption => `字幕 ${caption.startMs}–${caption.endMs} ms：${caption.text}`),
    ...(request.audio ?? []).map(audio => `音乐 ${audio.name}：${audio.startMs} ms 起播，音量 ${Math.round(audio.volume * 100)}%`),
  ].join("\n");
  return {
    type: "question", buttons: ["取消", "导出"], defaultId: 0, cancelId: 0,
    title: "确认导出视频", message: "导出视频到本地素材目录？",
    detail: `${request.format === "portrait" ? "竖屏 720×1280" : "横屏 1280×720"}\n${directory}\n\n${detail}\n${layers}\n本地导出：0 积分，不调用付费生成服务。`,
    noLink: true,
  };
}
