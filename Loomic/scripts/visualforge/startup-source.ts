function replaceStage(source: string, marker: string, replacement: string) {
  if (!source.includes(marker)) throw new Error(`Studio startup adaptation changed: ${marker.slice(0, 80)}`);
  return source.replace(marker, replacement);
}

export function patchStudioStartup(source: string) {
  let patched = replaceStage(source,
    "setLoadingProgress(total === 0 ? null : Math.min(0.95, loaded / total));",
    `setLoadingProgress(total === 0 ? null : Math.min(0.95, loaded / total));
      window.dispatchEvent(new CustomEvent("helstera:studio-stage", { detail: { phase: total > 0 && loaded >= total ? "compile" : "download", loadedBytes: loaded, totalBytes: total } }));`);
  patched = replaceStage(patched, "downloadProgress[asset]?.totalBytes ?? totalBytes", "downloadProgress[asset]?.totalBytes || totalBytes");
  patched = replaceStage(patched, "setLoadingProgress(0);", `setLoadingProgress(0);
    window.dispatchEvent(new CustomEvent("helstera:studio-stage", { detail: { phase: "download" } }));`);
  return patched;
}
