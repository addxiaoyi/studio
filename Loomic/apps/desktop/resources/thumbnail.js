function once(target, event) {
  return new Promise((resolve, reject) => {
    const done = () => { target.removeEventListener("error", failed); resolve(); };
    const failed = () => { target.removeEventListener(event, done); reject(new Error("此素材暂不能生成封面，请预览原文件。")); };
    target.addEventListener(event, done, { once: true }); target.addEventListener("error", failed, { once: true });
  });
}
window.createLocalThumbnail = async (url, mime) => {
  if (!url.startsWith("helstera-media://local/") || !/^(image|video)\//.test(mime)) throw new Error("素材类型不支持缩略图。");
  const source = mime.startsWith("image/") ? new Image() : document.createElement("video");
  try {
    if (source instanceof HTMLVideoElement) {
      source.muted = true; source.preload = "auto";
      const loaded = once(source, "loadeddata"); source.src = url; await loaded;
      const at = Number.isFinite(source.duration) ? Math.min(0.5, source.duration / 4) : 0;
      if (at > 0) { const seeked = once(source, "seeked"); source.currentTime = at; await seeked; }
    } else { const loaded = once(source, "load"); source.src = url; await loaded; }
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth, height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height || width * height > 100000000) throw new Error("素材分辨率过大或不可读取。");
    const ratio = Math.min(320 / width, 180 / height, 1), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d"); context.fillStyle = "#f2f3f5"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally { source.removeAttribute("src"); if (source instanceof HTMLVideoElement) source.load(); }
};
