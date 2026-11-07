"use client";

import { useState } from "react";
import { decodeFashionImage, type FashionResult } from "@/lib/fashion-generation";
import { getServerBaseUrl } from "@/lib/env";
import { SendVideoToChat } from "./send-video-to-chat";
import { CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";

export function FashionResultCard({ output, token, onSaved }: { output: FashionResult; token: string; onSaved(jobId: string, assetId: string): Promise<void> }) {
  const [assetId, setAssetId] = useState(output.assetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (busy || assetId) return;
    setBusy(true); setError("");
    try {
      const id = output.jobId.replace(/^(native|external):/, "");
      const form = new FormData();
      form.append("file", decodeFashionImage(output.image, "try-on"));
      const response = await fetch(getServerBaseUrl() + "/api/assets/private-try-on", { method: "POST", body: form,
        headers: { Authorization: "Bearer " + token, "Idempotency-Key": id }, redirect: "error" });
      if (!response.ok) throw new Error("保存失败，本机生成记录仍保留，可重试保存。");
      const reply = await response.json();
      if (typeof reply.assetId !== "string") throw new Error("素材保存响应无效，请重试保存。");
      await onSaved(output.jobId, reply.assetId);
      setAssetId(reply.assetId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs sm:px-8" aria-label="试穿结果回流">
    <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" /><span>{assetId ? "结果已在私有素材库保留三天。" : "结果已保存在本机生成记录。"}</span>
    {!assetId && <Button type="button" variant="outline" disabled={busy} onClick={save}>{busy ? "正在保存…" : "保存到私有素材库"}</Button>}
    {assetId && <SendVideoToChat media="image" assetId={assetId} token={token} />}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
