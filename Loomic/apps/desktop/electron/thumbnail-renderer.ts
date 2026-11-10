import { BrowserWindow, nativeImage } from "electron";
import type { LocalMedia } from "./local-media.js";

export async function renderLocalThumbnail(input: { root: string; path: string; mime: string }, media: LocalMedia, page: string): Promise<Buffer> {
  const window = new BrowserWindow({ show: false, width: 640, height: 480, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = await media.grant(input.root, input.path, input.mime);
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("封面生成超时，仍可预览原文件。")), 25000); });
    const render = (async () => {
      await window.loadFile(page);
      const encoded: unknown = await window.webContents.executeJavaScript(`window.createLocalThumbnail(${JSON.stringify(url)}, ${JSON.stringify(input.mime)})`);
      if (typeof encoded !== "string" || !encoded.startsWith("data:image/jpeg;base64,") || encoded.length > 350000) throw new Error("缩略图输出无效。");
      const image = nativeImage.createFromDataURL(encoded), size = image.getSize();
      if (image.isEmpty() || size.width > 320 || size.height > 180) throw new Error("缩略图尺寸无效。");
      return Buffer.from(encoded.slice(encoded.indexOf(",") + 1), "base64");
    })();
    return await Promise.race([render, timeout]);
  } finally { if (timer) clearTimeout(timer); if (!window.isDestroyed()) window.destroy(); }
}
