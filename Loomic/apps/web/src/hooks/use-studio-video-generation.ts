"use client";

import { cancelGenerationApproval, cancelJob } from "@/lib/server-api";
import {
  type StudioVideoDraft,
  type StudioVideoRequest,
  type StudioVideoState,
  approveStudioVideo,
  clearStudioVideo,
  createStudioVideo,
  inspectStudioVideo,
  readStudioVideo,
  resumeStudioVideo,
  submitStudioVideo,
} from "@/lib/studio-video-generation";
import { useCallback, useEffect, useMemo, useState } from "react";

const POLL_MS = 4000;
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "视频请求失败，请恢复原任务。";
type GenerationScope = {
  userId: string;
  token: string;
  active: boolean;
  pending: boolean;
  requests: Set<AbortController>;
};
type GenerationView = {
  scope: GenerationScope;
  state: StudioVideoState | null;
  busy: boolean;
  error: string;
};
const emptyView = (scope: GenerationScope): GenerationView => ({
  scope,
  state: null,
  busy: false,
  error: "",
});

export function useStudioVideoGeneration(userId: string, token: string) {
  const scope = useMemo<GenerationScope>(
    () => ({
      userId,
      token,
      active: false,
      pending: false,
      requests: new Set(),
    }),
    [userId, token],
  );
  const [view, setView] = useState(() => emptyView(scope));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    scope.active = true;
    scope.pending = false;
    return () => {
      scope.active = false;
      for (const request of scope.requests) request.abort();
    };
  }, [scope]);

  const update = useCallback(
    (patch: Partial<Omit<GenerationView, "scope">>) => {
      if (!scope.active) return;
      setView((current) =>
        scope.active
          ? {
              ...(current.scope === scope ? current : emptyView(scope)),
              ...patch,
            }
          : current,
      );
    },
    [scope],
  );

  const showRequest = useCallback(
    (request: StudioVideoRequest) => {
      setView((current) => {
        if (!scope.active) return current;
        const next = current.scope === scope ? current : emptyView(scope);
        return {
          ...next,
          state:
            next.state?.request.key === request.key
              ? next.state
              : { phase: "draft", request },
        };
      });
    },
    [scope],
  );

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === `loomic:studio-video:${scope.userId}`
      )
        setRevision((value) => value + 1);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [scope]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision retries the server query after a user action.
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      try {
        const request = readStudioVideo(scope.userId);
        if (!request) {
          update({ state: null, error: "" });
          return;
        }
        showRequest(request);
        const next = await inspectStudioVideo(
          scope.token,
          request,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (readStudioVideo(scope.userId)?.key !== request.key) {
          setRevision((value) => value + 1);
          return;
        }
        update({ state: next, error: "" });
        if (
          [
            "running",
            "reservation",
            "cancel_requested",
            "settlement_review",
            "approval",
          ].includes(next.phase)
        )
          timer = setTimeout(inspect, POLL_MS);
      } catch (cause) {
        if (!abort.signal.aborted) update({ error: message(cause) });
      }
    }
    void inspect();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [scope, revision, showRequest, update]);

  async function run(operation: (signal: AbortSignal) => Promise<unknown>) {
    if (!scope.active || scope.pending) return;
    scope.pending = true;
    const controller = new AbortController();
    scope.requests.add(controller);
    update({ busy: true, error: "" });
    try {
      if (!navigator.locks)
        throw new Error(
          "当前浏览器不支持安全请求锁，请使用新版 Chrome 或桌面客户端。",
        );
      await navigator.locks.request(
        `loomic:studio-video:${scope.userId}`,
        { ifAvailable: true },
        async (lock) => {
          if (controller.signal.aborted) return;
          if (!lock)
            throw new Error("另一个标签页正在提交视频请求，请稍后恢复原任务。");
          await operation(controller.signal);
        },
      );
    } catch (cause) {
      if (!controller.signal.aborted) update({ error: message(cause) });
    } finally {
      scope.requests.delete(controller);
      if (!controller.signal.aborted) {
        scope.pending = false;
        update({ busy: false });
        if (scope.active) setRevision((value) => value + 1);
      }
    }
  }

  function requireRequest(): StudioVideoRequest {
    const request = readStudioVideo(scope.userId);
    if (!request) throw new Error("没有可恢复的视频请求。");
    return request;
  }

  const start = (draft: StudioVideoDraft) =>
    run(async () => {
      const request = createStudioVideo(scope.userId, draft);
      update({ state: { phase: "draft", request } });
      await submitStudioVideo(scope.userId, scope.token, request);
    });
  const resume = () =>
    run(async (signal) => {
      await resumeStudioVideo(
        scope.userId,
        scope.token,
        requireRequest(),
        signal,
      );
    });
  const approve = () =>
    run(async () => {
      await approveStudioVideo(scope.userId, scope.token, requireRequest());
    });
  const cancel = () =>
    run(async (signal) => {
      const current = await inspectStudioVideo(
        scope.token,
        requireRequest(),
        signal,
      );
      signal.throwIfAborted();
      const request = current.request;
      if (request.jobId) await cancelJob(scope.token, request.jobId);
      else if (request.approval)
        await cancelGenerationApproval(
          scope.token,
          request.approval.approvalId,
        );
      else throw new Error("请求结果尚未确认，请先恢复原请求再取消。");
    });
  const reset = () =>
    run(async (signal) => {
      const request = requireRequest();
      const current = await inspectStudioVideo(scope.token, request, signal);
      signal.throwIfAborted();
      if (!["succeeded", "failed", "canceled"].includes(current.phase))
        throw new Error("请先取消当前任务或取回结果。");
      clearStudioVideo(scope.userId, request.key);
      update({ state: null });
    });
  const refresh = useCallback(() => {
    if (scope.active) setRevision((value) => value + 1);
  }, [scope]);
  const current = view.scope === scope ? view : emptyView(scope);
  return {
    state: current.state,
    busy: current.busy,
    error: current.error,
    start,
    resume,
    approve,
    cancel,
    reset,
    refresh,
  };
}
