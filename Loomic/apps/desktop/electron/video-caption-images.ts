import { BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoExportInput } from "./video-export-request.js";
import type { ExportCaption } from "./video-export-plan.js";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function renderVideoCaptions(request: VideoExportInput, directory: string): Promise<ExportCaption[]> {
  if (!request.captions?.length) return [];
  const [width, height] = request.format === "portrait" ? [720, 1280] : [1280, 720];
  const window = new BrowserWindow({ width, height, useContentSize: true, show: false, transparent: true, frame: false, backgroundColor: "#00000000", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
  try {
    const layers: ExportCaption[] = [];
    for (const [index, caption] of request.captions.entries()) {
      const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;background:transparent}div{position:absolute;bottom:80px;left:40px;right:40px;color:white;font:42px/1.3 'Microsoft YaHei','PingFang SC',sans-serif;text-align:center;text-shadow:0 2px 6px black;white-space:pre-wrap;overflow-wrap:anywhere}</style><div>${escapeHtml(caption.text)}</div>`;
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const image = (await window.webContents.capturePage()).resize({ width, height });
      const bitmap = image.toBitmap({ scaleFactor: 1 });
      if (bitmap.length !== width * height * 4) throw new Error("字幕渲染尺寸无效，请重试导出。");
      // The packaged encoder supports raw pixels but deliberately omits the PNG decoder.
      const sourcePath = join(directory, `caption-${index}.bgra`);
      await writeFile(sourcePath, bitmap, { flag: "wx" });
      layers.push({ sourcePath, startMs: caption.startMs, endMs: caption.endMs, bitmap: { width, height } });
    }
    return layers;
  } finally { window.destroy(); }
}
