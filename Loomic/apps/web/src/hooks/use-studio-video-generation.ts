"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelGenerationApproval, cancelJob } from "@/lib/server-api";
import {
  approveStudioVideo, clearStudioVideo, createStudioVideo, inspectStudioVideo, readStudioVideo,
  submitStudioVideo, type StudioVideoDraft, type StudioVideoRequest, type StudioVideoState,
} from "@/lib/studio-video-generation";

const POLL_MS = 4000;
const message = (cause: unknown) => cause instanceof Error ? cause.message : "视频任务处理失败，请恢复原任务。";

export function useStudioVideoGeneration(userId: string, token: string) {
  const [state, setState] = useState<StudioVideoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const gate = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === `loomic:studio-video:${userId}`) setRevision(value => value + 1);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision retries a failed server query after a user action.
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      try {
        const request = readStudioVideo(userId);
        if (!request) { setState(null); return; }
        setState(current => current?.request.key === request.key ? current : { phase: "draft", request });
        const next = await inspectStudioVideo(token, request, abort.signal);
        if (abort.signal.aborted) return;
        if (readStudioVideo(userId)?.key !== request.key) { setRevision(value => value + 1); return; }
        setState(next);
        if (["running", "approval"].includes(next.phase)) timer = setTimeout(inspect, POLL_MS);
      } catch (cause) { if (!abort.signal.aborted) setError(message(cause)); }
    }
    void inspect();
    return () => { alive.current = false; abort.abort(); clearTimeout(timer); };
  }, [userId, token, revision]);

  async function run(operation: () => Promise<unknown>) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError("");
    try {
      if (!navigator.locks) throw new Error("此浏览器不支持安全的任务锁，请使用最新版 Chrome 或桌面客户端。");
      await navigator.locks.request(`loomic:studio-video:${userId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("另一个标签页正在提交视频任务，请稍后恢复原任务。");
        await operation();
      });
    }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally {
      gate.current = false;
      if (alive.current) { setBusy(false); setRevision(value => value + 1); }
    }
  }

  function requireRequest(): StudioVideoRequest {
    const request = readStudioVideo(userId);
    if (!request) throw new Error("没有可恢复的视频任务。");
    return request;
  }

  const start = (draft: StudioVideoDraft) => run(async () => {
    const request = createStudioVideo(userId, draft);
    setState({ phase: "draft", request });
    await submitStudioVideo(userId, token, request);
  });
  const resume = () => run(async () => {
    await submitStudioVideo(userId, token, requireRequest());
  });
  const approve = () => run(async () => { await approveStudioVideo(userId, token, requireRequest()); });
  const cancel = () => run(async () => {
    const current = await inspectStudioVideo(token, requireRequest());
    const request = current.request;
    if (request.jobId) await cancelJob(token, request.jobId);
    else if (request.approval) await cancelGenerationApproval(token, request.approval.approvalId);
    else throw new Error("请求结果尚未确认，请先恢复原任务后取消。");
    // Re-read authoritative state after cancel; an in-flight job may already have completed.
  });
  const reset = () => run(async () => {
    const request = requireRequest();
    const current = await inspectStudioVideo(token, request);
    if (!["succeeded", "failed", "canceled"].includes(current.phase)) throw new Error("请先取消当前任务或取回结果。");
    clearStudioVideo(userId, request.key); setState(null);
  });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { state, busy, error, start, resume, approve, cancel, reset, refresh };
}
