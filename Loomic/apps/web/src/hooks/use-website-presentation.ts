"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CreateWebsiteCaptureRequest,
  WebsiteCaptureTask,
  WebsitePresentation,
  WebsiteLoginCredentials,
  WebsiteJourney,
} from "@helstera/shared";
import {
  cancelWebsiteCapture,
  createWebsiteCapture,
  decideWebsiteRecording,
  fetchWebsiteCapture,
  type RecordingApproval,
} from "@/lib/server-api";
import { openAgentBrowser } from "@/lib/agent-browser-api";
import { saveWebsiteLoginCredentials } from "@/lib/website-login-api";

type Saved = {
  key: string;
  input: CreateWebsiteCaptureRequest;
  taskId?: string;
};
const savedKey = (userId: string) => `loomic:website-presentation:${userId}`;
export function useWebsitePresentation(userId: string, token: string) {
  const [saved, setSaved] = useState<Saved | null>(null),
    [task, setTask] = useState<WebsiteCaptureTask | null>(null);
  const [approval, setApproval] = useState<RecordingApproval | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    [revision, setRevision] = useState(0);
  function remember(next: Saved | null) {
    if (next) localStorage.setItem(savedKey(userId), JSON.stringify(next));
    else localStorage.removeItem(savedKey(userId));
    setSaved(next);
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(savedKey(userId));
      if (!raw) return;
      const prior = JSON.parse(raw) as Saved;
      if (typeof prior.key !== "string" || !prior.input?.recordVideo)
        throw new Error("演示恢复记录无效，请从任务记录核对。");
      setSaved(prior);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "读取演示恢复记录失败。",
      );
    }
  }, [userId]);
  useEffect(() => {
    if (!saved?.taskId) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const details = await fetchWebsiteCapture(token, saved!.taskId!);
        if (stopped) return;
        setTask(details.task);
        setApproval(details.recordingApproval ?? null);
        setError("");
        if (["queued", "running"].includes(details.task.status))
          timer = setTimeout(poll, 1500);
      } catch (cause) {
        if (!stopped) {
          setError(
            cause instanceof Error ? cause.message : "读取演示状态失败。",
          );
          timer = setTimeout(poll, 4000);
        }
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [saved?.taskId, token, revision]);
  async function exclusive(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "网站演示未完成，请重试。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function prepare(url: string, config?: WebsitePresentation, credentials?: WebsiteLoginCredentials,journey?:WebsiteJourney,startNow=false) {
    await exclusive(async () => {
      if (saved?.taskId) {
        setRevision((value) => value + 1);
        return;
      }
      const current = new URL(window.location.href);
      const sessionId = current.searchParams.get("session");
      const key = saved?.key ?? crypto.randomUUID();
      const login = !saved&&credentials?await saveWebsiteLoginCredentials(token,credentials):undefined;
      const input = saved?.input ?? {
        url,
        mode: "isolated" as const,
        pageLimit: journey?journey.steps.length:config?1:3,
        recordVideo: true,
        followExternal: false,
        ...(config?{presentation:config}:{}),
        ...(login?{login}:{}),
        ...(journey?{journey}:{}),
        idempotencyKey: key,
        ...(sessionId ? { sessionId } : {}),
      };
      remember({ key, input });
      const created = await createWebsiteCapture(token, input);
      remember({ key, input, taskId: created.task.id });
      setTask(created.task);
      const details = await fetchWebsiteCapture(token, created.task.id);
      setApproval(details.recordingApproval ?? null);
      if(startNow&&details.recordingApproval){
        const accepted=await decideWebsiteRecording(token,created.task.id,details.recordingApproval.id,'approve');
        setTask(accepted.task);setApproval(null);openAgentBrowser(created.task.id);
      }
    });
  }
  async function decide(accepted: boolean) {
    await exclusive(async () => {
      if (!saved?.taskId || !approval)
        throw new Error("录制审批已失效，请重新准备演示。");
      const reply = await decideWebsiteRecording(
        token,
        saved.taskId,
        approval.id,
        accepted ? "approve" : "reject",
      );
      setTask(reply.task);
      setApproval(null);
      setRevision((value) => value + 1);
      if (accepted) openAgentBrowser(saved.taskId);
    });
  }
  async function cancel() {
    await exclusive(async () => {
      if (!saved?.taskId) return;
      const reply = await cancelWebsiteCapture(token, saved.taskId);
      setTask(reply.task);
      setApproval(null);
      setRevision((value) => value + 1);
    });
  }
  function reset() {
    if (task && ["queued", "running"].includes(task.status)) return;
    remember(null);
    setTask(null);
    setApproval(null);
    setError("");
  }
  return {
    saved,
    task,
    approval,
    busy,
    error,
    prepare,
    approve: () => decide(true),
    reject: () => decide(false),
    cancel,
    reset,
    retry: () => setRevision((value) => value + 1),
  };
}
