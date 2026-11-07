"use client";

import { AppSelect } from "@/components/ui/app-select";

import { useState } from "react";
import { getServerBaseUrl } from "@/lib/env";
import { useVideoText } from "@/lib/video-copy";

type Session = { id: string; title: string; canvasName: string; canvasId: string };

export function SendVideoToChat({ assetId, token, media = "video" }: { assetId: string; token: string; media?: "image" | "video" }) {
  const copy = useVideoText();
  const endpoint = media === "image" ? "private-try-on" : "private-video";
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivered, setDelivered] = useState(false);

  async function loadSessions() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${getServerBaseUrl()}/api/assets/${endpoint}/chat-sessions`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include", redirect: "error" });
      if (!response.ok) throw new Error("无法加载聊天会话，请重试。");
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("sessions" in payload) || !Array.isArray(payload.sessions) || !payload.sessions.every((item: unknown) => item && typeof item === "object" && ["id", "title", "canvasName", "canvasId"].every((key) => typeof (item as Record<string, unknown>)[key] === "string"))) throw new Error("聊天会话数据无效。");
      setSessions(payload.sessions as Session[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载聊天会话。"); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setDelivered(false);
    try {
      const response = await fetch(`${getServerBaseUrl()}/api/assets/${endpoint}/${encodeURIComponent(assetId)}/send-to-chat`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: selected }), credentials: "include", redirect: "error",
      });
      if (!response.ok) throw new Error("发送失败，素材或会话可能已不可用，请重试。");
      setDelivered(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败，请重试。"); }
    finally { setBusy(false); }
  }

  const target = sessions?.find((item) => item.id === selected);
  return <div className="flex flex-wrap items-center gap-2">
    {sessions === null ? <button type="button" onClick={loadSessions} disabled={busy} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{copy(busy ? "正在加载会话" : "发送到聊天")}</button> : <>
      <label className="text-sm">{copy("聊天会话")} <AppSelect value={selected} onChange={(event) => { setSelected(event.currentTarget.value); setDelivered(false); }} disabled={busy} className="max-w-64 rounded border bg-background p-2"><option value="">{copy(sessions.length ? "选择会话" : "没有可用会话")}</option>{sessions.map((item) => <option key={item.id} value={item.id}>{item.canvasName} / {item.title}</option>)}</AppSelect></label>
      <button type="button" onClick={send} disabled={!selected || busy} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{copy("发送")}</button>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{copy(error)}</p>}
    {delivered && target && <p role="status" className="text-sm">{copy("已发送。")}<a className="underline" href={`/canvas/?${new URLSearchParams({ id: target.canvasId, session: target.id })}`}>{copy("打开聊天")}</a></p>}
  </div>;
}
