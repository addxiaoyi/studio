"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WebsiteCaptureResult } from "@helstera/shared";
import { addWebsiteCaptureToCanvas, fetchCanvas } from "@/lib/server-api";
import { Button } from "@/components/ui/button";

type Delivery = NonNullable<WebsiteCaptureResult["canvasDelivery"]>;
export function announceCaptureCanvas(delivery: Delivery, focus = false) {
  if (delivery.status === "succeeded") window.dispatchEvent(new CustomEvent("loomic:capture-canvas", { detail: { ...delivery, focus } }));
}

export function CaptureCanvasActions({ taskId, result, token }: { taskId: string; result: WebsiteCaptureResult; token: string }) {
  const [delivery, setDelivery] = useState(result.canvasDelivery);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [canvasName, setCanvasName] = useState("");
  const currentCanvasId = typeof location === "undefined" ? null : new URL(location.href).searchParams.get("id");
  const elsewhere = Boolean(delivery?.canvasId && delivery.canvasId !== currentCanvasId);
  useEffect(() => {
    let active = true; setCanvasName("");
    if (delivery?.canvasId) void fetchCanvas(token, delivery.canvasId).then(({ canvas }) => { if (active) setCanvasName(canvas.name); }).catch(() => { if (active) setCanvasName("原任务画布"); });
    return () => { active = false; };
  }, [delivery?.canvasId, token]);
  const attempted = useRef(false);
  const addToCanvas = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const receipt = await addWebsiteCaptureToCanvas(token, taskId);
      setDelivery(receipt);
      announceCaptureCanvas(receipt, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "素材添加失败，请重试。"); }
    finally { setBusy(false); }
  }, [token, taskId]);
  useEffect(() => {
    setDelivery(result.canvasDelivery);
    if (result.canvasDelivery) announceCaptureCanvas(result.canvasDelivery);
    if (result.canvasDelivery?.status === "pending" && !attempted.current) {
      attempted.current = true;
      void addToCanvas();
    }
  }, [result.canvasDelivery, addToCanvas]);
  function locate() {
    if (!delivery) return;
    if (elsewhere && delivery.canvasId) { window.location.assign(`/canvas/?${new URLSearchParams({ id: delivery.canvasId, capture: taskId, focusElements: delivery.elementIds.join(",") })}`); return; }
    announceCaptureCanvas(delivery, true);
  }
  function editRecording() {
    if (!result.recordingAssetId) return;
    const query = new URLSearchParams({ assetId: result.recordingAssetId, edit: "1", title: `网站录像 · ${result.title}` });
    if (delivery?.canvasId) query.set("returnCanvas", delivery.canvasId);
    window.location.assign(`/video/?${query}`);
  }
  if (delivery?.status === "unlinked") return <p className="text-xs text-muted-foreground">素材已保存到素材库；此任务没有关联画布。</p>;
  return <div className="flex flex-wrap items-center gap-2" aria-label="录制素材与画布">
    {delivery?.status === "succeeded" ? <>
      <span role="status" className="text-xs text-muted-foreground">截图与录像已添加到{elsewhere ? "原任务画布" : "当前画布"}{canvasName ? `「${canvasName}」` : ""}</span>
      <Button type="button" size="sm" variant="outline" onClick={locate}>{elsewhere ? "打开原画布素材" : "定位画布素材"}</Button>
    </> : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={addToCanvas}>{busy ? "正在添加到画布…" : delivery?.status === "failed" ? "重试添加到画布" : "添加截图与录像到画布"}</Button>}
    {result.recordingAssetId && <Button type="button" size="sm" variant="outline" onClick={editRecording}>让 AI 剪辑录像</Button>}
    {(error || delivery?.error) && <p role="alert" className="w-full text-xs text-destructive">{error || delivery?.error}</p>}
  </div>;
}
