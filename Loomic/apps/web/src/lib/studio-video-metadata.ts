import { STUDIO_FPS } from "./studio-cut";

export function studioVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const video = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    video.preload = "metadata";
    let ended = false;
    const timer = window.setTimeout(() => finish(undefined, new Error("读取视频时长超时，请检查素材格式。")), 15000);
    function finish(duration?: number, cause?: Error) {
      if (ended) return;
      ended = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = null; video.ondurationchange = null; video.onerror = null;
      video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
      if (cause) reject(cause); else resolve(duration!);
    }
    function accept() { if (Number.isFinite(video.duration) && video.duration >= 1 / STUDIO_FPS) finish(video.duration); }
    video.ondurationchange = accept;
    video.onloadedmetadata = () => {
      if (video.duration !== Infinity) { accept(); return; }
      try { video.currentTime = 1e101; }
      catch { finish(undefined, new Error("无法读取此录屏的有效时长。")); }
    };
    video.onerror = () => finish(undefined, new Error("无法解码视频，请选择 MP4 或 WebM 素材。"));
    video.src = url;
  });
}
