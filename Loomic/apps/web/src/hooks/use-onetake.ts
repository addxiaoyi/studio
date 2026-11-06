"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { oneTakeApi, type OneTakeCapabilities } from "@/lib/onetake-api";
import type { TranscriptTask, TranscriptSummary } from "@helstera/shared";

export function useOneTake(token: string, selected: string) {
  const [tasks, setTasks] = useState<TranscriptSummary[]>([]);
  const [task, setTask] = useState<TranscriptTask | null>(null);
  const cached = useRef<TranscriptTask | null>(null);
  const [capabilities, setCapabilities] = useState<OneTakeCapabilities | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [list, supported] = await Promise.all([oneTakeApi.tasks(token, signal), oneTakeApi.capabilities(token, signal)]);
    const summary = list.find(item => item.id === selected);
    const previous = cached.current;
    const unchanged = previous?.id === selected && summary && previous.revision === summary.revision && previous.state === summary.state && previous.progress === summary.progress;
    const detail = selected ? unchanged ? previous : await oneTakeApi.task(token, selected, signal) : null;
    const history = detail && !summary ? [detail, ...list] : list;
    if (!signal?.aborted) { cached.current = detail; setTask(detail); setTasks(history); setCapabilities(supported); setError(""); setLoading(false); }
  }, [token, selected]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try { await refresh(controller.signal); }
      catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "无法读取转写任务。"); setLoading(false); } }
      finally { pending = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  return { tasks, task: task?.id === selected ? task : null, capabilities, error, loading, refresh };
}

export function useOneTakeMedia(token: string, path: string | null) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setUrl(""); setError("");
    if (!path) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void oneTakeApi.media(token, path, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "媒体加载失败。"); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, path]);
  return { url, error };
}
