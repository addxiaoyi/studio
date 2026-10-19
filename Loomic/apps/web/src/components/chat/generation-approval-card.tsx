"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../../lib/auth-context";
import { cancelGenerationApproval, confirmGenerationApproval, confirmLatestGenerationApproval, fetchGenerationApprovalStatus } from "../../lib/server-api";

export type GenerationApprovalCardProps = {
  approvalId?: string;
  canvasId?: string;
  jobType: "image_generation" | "video_generation";
  model: string;
  estimatedCredits: number;
  duration?: number;
  resolution?: string;
  hasReferenceImage: boolean;
  expiresAt: string;
  onJobCreated?: (jobId: string) => void;
};

export function GenerationApprovalCard(props: GenerationApprovalCardProps) {
  const { session } = useAuth();
  const [state, setState] = useState<"pending" | "submitting" | "approved" | "rejected" | "expired" | "failed" | "terminal_failed">("pending");
  const [failure, setFailure] = useState<string>();
  const [cancelFailure, setCancelFailure] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const actionInFlightRef = useRef(false);
  const announcedJobId = useRef<string | undefined>(undefined);
  const expiresAt = useMemo(() => new Date(props.expiresAt).getTime(), [props.expiresAt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!props.approvalId || !session?.access_token) return;
    let stopped = false;
    let timer: number | undefined;
    const terminalStatuses = new Set(["failed", "dead_letter", "canceled"]);

    const poll = async () => {
      let terminal = Date.now() >= expiresAt;
      if (terminal) setState("expired");
      try {
        if (terminal) return;
        const status = await fetchGenerationApprovalStatus(session.access_token, props.approvalId!);
        if (stopped) return;
        const jobId = typeof status.jobId === "string" ? status.jobId : undefined;
        if (jobId && announcedJobId.current !== jobId) {
          announcedJobId.current = jobId;
          props.onJobCreated?.(jobId);
        }
        const jobStatus = typeof status.jobStatus === "string" ? status.jobStatus : "";
        if (status.approvalStatus === "rejected") {
          setState("rejected");
          terminal = true;
        } else if (status.approvalStatus === "expired") {
          setState("expired");
          terminal = true;
        } else if (jobStatus === "succeeded") {
          setState("approved");
          terminal = true;
        } else if (terminalStatuses.has(jobStatus)) {
          setFailure(typeof status.error === "string" ? status.error : "Generation stopped before completion.");
          setState("terminal_failed");
          terminal = true;
        } else if (status.approvalStatus === "approved") {
          setState("approved");
        }
      } catch {
        // Keep the confirmation action usable through a transient status error.
      }
      if (!stopped && !terminal && Date.now() < expiresAt) {
        timer = window.setTimeout(() => void poll(), 3_000);
      } else if (!stopped && Date.now() >= expiresAt) {
        setState("expired");
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [expiresAt, props.approvalId, props.onJobCreated, session?.access_token]);

  const expired = now >= expiresAt || state === "expired";
  const canSubmit = !expired && (state === "pending" || state === "failed") && Boolean(session?.access_token);
  const disabled = !canSubmit;
  const submitting = state === "submitting";
  const remainingMinutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const terminalStatus = expired
    ? "expired"
    : state === "rejected" || state === "approved" || state === "terminal_failed"
      ? state as "rejected" | "approved" | "terminal_failed"
      : null;
  const terminalMessage = terminalStatus === "expired"
    ? "确认已过期，此任务不会再启动。"
    : terminalStatus === "rejected"
      ? "生成确认已取消，未创建任务。"
      : terminalStatus === "terminal_failed"
        ? `任务已停止：${failure ?? "生成未完成。"}`
        : "已确认，生成任务状态会显示在对应消息中。";

  async function confirm() {
    if (!canSubmit || !session?.access_token || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setState("submitting");
    try {
      const response = props.approvalId
        ? await confirmGenerationApproval(session.access_token, props.approvalId)
        : props.canvasId
          ? await confirmLatestGenerationApproval(session.access_token, props.canvasId)
          : null;
      if (!response) throw new Error("No generation confirmation is available.");
      if (!response.data.jobId) throw new Error("The generation job was not created.");
      props.onJobCreated?.(response.data.jobId);
      setState("approved");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "提交任务失败，请重试。");
      setState("failed");
    } finally {
      actionInFlightRef.current = false;
    }
  }

  async function cancel() {
    if (disabled || !session?.access_token || !props.approvalId || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setCancelFailure(undefined);
    setState("submitting");
    try {
      await cancelGenerationApproval(session.access_token, props.approvalId);
      setState("rejected");
      setFailure(undefined);
    } catch (error) {
      setCancelFailure(error instanceof Error ? error.message : "Unable to cancel this confirmation.");
      setState("pending");
    } finally {
      actionInFlightRef.current = false;
    }
  }

  if (Boolean(terminalStatus)) {
    return (
      <section className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground" role="status" aria-label="Generation confirmation status">
        <p>{terminalMessage}</p>
        {terminalStatus === "terminal_failed" && failure ? <p className="mt-1 break-words text-destructive">{failure}</p> : null}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4" aria-label="Generation confirmation">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {props.jobType === "video_generation" ? "准备生成视频" : "准备生成图片"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">确认后才会创建任务并扣除 credits。</p>
        </div>
        <span className="text-xs text-muted-foreground">{expired ? "确认已过期" : `有效期 ${remainingMinutes} 分钟`}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-muted-foreground">模型</dt><dd className="font-medium text-foreground">{props.model}</dd></div>
        {props.duration != null && <div><dt className="text-muted-foreground">时长</dt><dd className="font-medium text-foreground">{props.duration} 秒</dd></div>}
        {props.resolution && <div><dt className="text-muted-foreground">分辨率</dt><dd className="font-medium text-foreground">{props.resolution}</dd></div>}
        <div><dt className="text-muted-foreground">参考图</dt><dd className="font-medium text-foreground">{props.hasReferenceImage ? "已注入" : "无"}</dd></div>
        <div><dt className="text-muted-foreground">预计消耗</dt><dd className="font-medium text-foreground">{props.estimatedCredits} credits</dd></div>
      </dl>
      {state === "approved" ? <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">任务已提交，正在查询实际生成状态。</p> : null}
      {state === "failed" ? <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{failure}</p> : null}
      {cancelFailure ? <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{cancelFailure}</p> : null}
      {state === "terminal_failed" ? <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">任务已停止，未完成生成：{failure}</p> : null}
      {state === "rejected" ? <p className="mt-3 text-xs text-muted-foreground">已取消，不会创建任务。</p> : null}
      {expired ? <p role="status" className="mt-3 text-xs text-muted-foreground">{"\u786e\u8ba4\u5df2\u8fc7\u671f\uff0c\u65e7\u6d88\u606f\u4e2d\u7684\u6309\u94ae\u4e0d\u518d\u53ef\u64cd\u4f5c\uff0c\u8bf7\u91cd\u65b0\u53d1\u8d77\u751f\u6210\u3002"}</p> : null}
      {!expired && state === "failed" ? (
        <button type="button" onClick={confirm} disabled={submitting || expired || !session?.access_token} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-50">
          重新提交
        </button>
      ) : null}
      {!expired && (state === "pending" || state === "submitting") ? (
        <div className="mt-4 flex gap-2">
          <button type="button" disabled={disabled || submitting} onClick={confirm} className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50">
            {submitting ? "提交中…" : "确认生成"}
          </button>
          <button type="button" disabled={disabled || submitting} onClick={cancel} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground disabled:opacity-50">取消</button>
        </div>
      ) : null}
    </section>
  );
}
