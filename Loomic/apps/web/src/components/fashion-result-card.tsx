"use client";

import { useEffect, useState } from "react";
import { fetchAssetRetention, type AssetRetentionView } from "@/lib/server-api";
import { decodeFashionImage, type FashionResult } from "@/lib/fashion-generation";
import { getServerBaseUrl } from "@/lib/env";
import { SendVideoToChat } from "./send-video-to-chat";
import { CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";

export function FashionResultCard({ output, token, onSaved }: { output: FashionResult; token: string; onSaved(jobId: string, assetId: string): Promise<void> }) {
  const [assetId, setAssetId] = useState(output.assetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retention, setRetention] = useState<AssetRetentionView | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!assetId) return;
    let active = true;
    setChecking(true); setCheckError(""); setRetention(null);
    void fetchAssetRetention(token, assetId).then(status => {if(active)setRetention(status);})
      .catch(() => {if(active)setCheckError("无法核验云端保留状态，请刷新检查；本机生成记录仍保留。");})
      .finally(() => {if(active)setChecking(false);});
    const timer = setInterval(() => setClock(Date.now()), 30000);
    const visible = () => {if(!document.hidden)setRefresh(value=>value+1);};
    document.addEventListener("visibilitychange",visible);
    return () => {active=false;clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  }, [assetId, token, refresh]);
  const expired = retention?.retentionUntil ? Date.parse(retention.retentionUntil) <= clock : false;
  const available = retention?.state === "active" && !expired;
  const storageLabel = !assetId ? "结果已保存在本机生成记录。" : checking ? "正在核验私有素材状态…" : !retention ? "云端状态尚未确认。" : retention.state === "purged" ? "云端文件已清理，本机生成记录仍保留。" : retention.state === "soft_deleted" ? "云端素材已删除，可到素材库检查恢复期限。" : expired ? "云端素材已到期，本机生成记录仍保留。" : retention.retentionUntil ? `私有素材保留至 ${new Date(retention.retentionUntil).toLocaleString()}。` : "私有素材当前可用，服务器未提供到期时间。";
  async function save() {
    if (busy || assetId) return;
    setBusy(true); setError("");
    try {
      const id = output.jobId.replace(/^(native|external):/, "");
      const form = new FormData();
      form.append("file", decodeFashionImage(output.image, "try-on"));
      const response = await fetch(getServerBaseUrl() + "/api/assets/private-try-on", { method: "POST", body: form,
        headers: { ...(token === "local-cookie" ? {} : {Authorization: "Bearer " + token}), "Idempotency-Key": id }, credentials:"include", redirect: "error" });
      if (!response.ok) throw new Error("保存失败，本机生成记录仍保留，可重试保存。");
      const reply = await response.json();
      if (typeof reply.assetId !== "string") throw new Error("素材保存响应无效，请重试保存。");
      await onSaved(output.jobId, reply.assetId);
      setAssetId(reply.assetId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs sm:px-8" aria-label="试穿结果回流">
    <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" /><span role="status">{storageLabel}</span>
    {!assetId && <Button type="button" variant="outline" disabled={busy} onClick={save}>{busy ? "正在保存…" : "保存到私有素材库"}</Button>}
    {assetId && available && <SendVideoToChat media="image" assetId={assetId} token={token} />}
    {assetId && <Button variant="outline" disabled={checking} onClick={()=>setRefresh(value=>value+1)}>刷新保留状态</Button>}
    {checkError && <p role="alert" className="text-destructive">{checkError}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
