"use client";

import { useEffect, useState } from "react";
import { getServerBaseUrl } from "@/lib/env";
import { saveStudioExport, type StudioExport } from "@/lib/visualforge-storage";
import { SendVideoToChat } from "./send-video-to-chat";
import { useVideoText } from "@/lib/video-copy";

export function StudioExportCard({ output, userId, token }: { output: StudioExport; userId: string; token: string }) {
  const copy = useVideoText();
  const [preview, setPreview] = useState("");
  const [assetId, setAssetId] = useState(output.assetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(output.blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [output.blob]);
  async function save() {
    if (busy || assetId) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", output.blob, output.name.split(/[\\/]/).pop());
      const response = await fetch(getServerBaseUrl() + "/api/assets/private-video", { method: "POST", body: form,
        headers: { Authorization: "Bearer " + token, "Idempotency-Key": output.id }, redirect: "error" });
      if (!response.ok) throw new Error("素材保存失败，本机导出文件仍保留，可重试上传。");
      const saved = await response.json();
      if (typeof saved.assetId !== "string" || !/^[a-f\d-]{36}$/i.test(saved.assetId)) throw new Error("素材保存响应无效，请重试原上传。");
      await saveStudioExport(userId, { ...output, assetId: saved.assetId });
      setAssetId(saved.assetId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  const video = /video\/(mp4|webm)/.test(output.blob.type);
  return <article className="space-y-3 rounded border p-3">
    <p className="text-sm">{output.name} · {(output.blob.size / 1024 / 1024).toFixed(2)} MB</p>
    {video && preview && <video controls preload="metadata" src={preview} className="max-h-64 w-full bg-black" />}
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <a href={preview} download={output.name.split(/[\\/]/).pop()} className="rounded border px-3 py-2">{copy("下载文件")}</a>
      {video && !assetId && <button type="button" disabled={busy} onClick={save} className="rounded border px-3 py-2">{copy(busy ? "正在保存…" : "保存到私有素材库（三天临时副本）")}</button>}
      {assetId && <SendVideoToChat assetId={assetId} token={token} />}
      {assetId && output.canvasId && <a className="rounded border px-3 py-2" href={`/canvas/?${new URLSearchParams({ id: output.canvasId, assetId, mediaType: "video" })}`}>添加成片到原画布</a>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{copy(error)}</p>}
  </article>;
}
