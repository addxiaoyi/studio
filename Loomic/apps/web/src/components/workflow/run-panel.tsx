"use client";
import { useEffect, useState } from "react";
import type { AgentGoal } from "@helstera/shared";
import { fetchAgentGoal, updateAgentGoal } from "@/lib/server-api";
import { getServerBaseUrl } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";
import { GenerationApprovalCard, type GenerationApprovalCardProps } from "@/components/chat/generation-approval-card";
import { workflowStepState } from "./step-state";
import { WorkflowGenerationInputs } from "./generation-inputs";

const statusLabels: Record<string, string> = {
  draft: "待确认",
  running: "执行中",
  waiting_approval: "等待动作确认",
  waiting_desktop: "等待执行器",
  paused: "已暂停",
  completed: "全部完成",
  failed: "执行失败",
  canceled: "已取消",
};
export function WorkflowRunPanel({
  token,
  goal,
  onRefresh,
  onSelectNode,
  nodeIds,targetTitle,
}: { token: string; goal: AgentGoal; onRefresh(): Promise<void>; onSelectNode?:((id:string)=>void)|undefined; nodeIds?:string[]|undefined; targetTitle?:string|undefined }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [filter,setFilter]=useState<"all"|"attention"|"completed">("all");
  const steps=goal.executionSteps??[];
  const visible=steps.filter(step=>filter==="all"||filter==="completed"&&step.state==="succeeded"||filter==="attention"&&["failed","review","waiting_approval","waiting_desktop"].includes(workflowStepState(step)));
  async function operate(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "运行操作失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    step: NonNullable<AgentGoal["executionSteps"]>[number],
    decision: string,
    review = false,
  ) {
    const response = await fetch(
      `${getServerBaseUrl()}/api/agent/goals/${goal.id}/steps/${step.id}/${review ? "review" : "decision"}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          review
            ? { outcome: decision }
            : { decision, fingerprint: step.fingerprint },
        ),
      },
    );
    const reply = (await response.json()) as { error?: { message?: string } };
    if (!response.ok)
      throw new Error(
        reply.error?.message ?? "审批或核验失败，请刷新状态后重试。",
      );
  }
  return (
    <section className="workflow-run" aria-label="工作流运行记录">
      {targetTitle&&<p className="node-data-caption">局部运行 · 执行到「{targetTitle}」</p>}
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {statusLabels[goal.status] ?? goal.status}
        </h3>
        <span className="text-xs text-muted-foreground">
          {goal.executionSteps?.filter((step) => step.state === "succeeded")
            .length ?? 0}
          /{goal.plan.steps.length} 步
        </span>
      </header>
      <div className="my-3 flex flex-wrap gap-2">
        {["running", "waiting_approval", "waiting_desktop"].includes(
          goal.status,
        ) && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void operate(() => updateAgentGoal(token, goal.id, "pause"))
            }
          >
            暂停
          </Button>
        )}
        {goal.status === "paused" &&
          !goal.executionSteps?.some((step) => step.state === "review") && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void operate(() => updateAgentGoal(token, goal.id, "resume"))
              }
            >
              继续执行
            </Button>
          )}
        {["running", "waiting_approval", "waiting_desktop", "paused"].includes(
          goal.status,
        ) && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void operate(() => updateAgentGoal(token, goal.id, "cancel"))
            }
          >
            取消运行
          </Button>
        )}
        {goal.status === "failed" && !goal.executionSteps?.some(step=>step.executor === "media.generate" && step.state === "failed") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void operate(() => updateAgentGoal(token, goal.id, "retry"))
            }
          >
            重试未完成步骤
          </Button>
        )}
      </div>
      {(error || goal.error) && (
        <p role="alert" className="my-3 text-xs text-destructive">
          {error || goal.error}
        </p>
      )}
      {goal.status === "failed" && goal.executionSteps?.some(step=>step.executor === "media.generate" && step.state === "failed") && <p className="my-3 text-xs text-muted-foreground">已提交的生成任务保留在素材库中。核对任务结果后，可修改节点并重新运行；新生成仍需再次确认费用。</p>}
      <div className="workflow-run-filter" role="group" aria-label="筛选执行步骤">{([["all","全部"],["attention","需处理"],["completed","已完成"]] as const).map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
      {!visible.length&&<p role="status" className="node-data-empty">{steps.length?"没有符合条件的步骤。":"正在等待执行步骤。"}</p>}
      <ol className="space-y-3">
        {visible.map((step) => (
          <li
            key={step.id}
            className="rounded-lg border border-border p-3 text-xs"
          >
            <div className="flex justify-between gap-2">
              {onSelectNode&&(!nodeIds||nodeIds.includes(step.stepId))?<button type="button" className="workflow-run-node-link" onClick={()=>onSelectNode(step.stepId)} aria-label={`定位节点：${step.title}`}>{step.title}</button>:<strong>{step.title}</strong>}
              <span>
                {(
                  {
                    skipped:"已跳过",pinned:"复用固定结果",waiting:"等待中",
                    queued: "待执行",
                    running: "执行中",
                    waiting_approval: "待确认",
                    waiting_desktop: "等待生成 / 执行器",
                    succeeded: "完成",
                    review: "待核验",
                    failed: "失败",
                    canceled: "取消",
                  } as Record<string, string>
                )[workflowStepState(step)] ?? step.state}
              </span>
            </div>
            {step.error && (
              <p className="mt-2 text-destructive">{step.error}</p>
            )}
            {step.executor==="flow.batch"&&typeof step.output?.processed==="number"&&typeof step.output?.total==="number"&&<p role="status" className="mt-2 text-muted-foreground">已处理 {step.output.processed} / {step.output.total} 项 · 分批进度已保存</p>}
            {step.executor === "media.generate" && Boolean(step.output?.generationApproval) && <div className="mt-3"><GenerationApprovalCard {...step.output!.generationApproval as GenerationApprovalCardProps} onJobCreated={()=>void onRefresh()} /></div>}
            {step.executor === "media.generate" && <WorkflowGenerationInputs preview={step.output?.generationPreview} token={token} />}
            {Boolean(step.output?.generationJob) && <p className="mt-2 text-muted-foreground">{String((step.output!.generationJob as {stage?:string}).stage || "生成任务处理中")} · {Number((step.output!.generationJob as {progress?:number}).progress)||0}%</p>}
            {Array.isArray(step.output?.shots) && <ol className="mt-3 space-y-2">{(step.output.shots as Array<{title:string;description:string;duration:number}>).map((shot,index)=><li key={index}><strong>镜头 {index+1} · {shot.title}</strong><p className="mt-1 text-muted-foreground">{shot.description}</p><span>{shot.duration}秒</span></li>)}</ol>}
            {step.state === "waiting_approval" && (
              <div className="mt-2 space-y-2">
                <p>
                  {step.command.executor === "web.capture"
                    ? `录制 ${step.command.url ?? "搜索结果网址"}，最多${step.command.pageLimit}页`
                    : step.command.executor === "media.frame"
                      ? `从已连接视频的第 ${step.command.at} 秒提取参考图，供后续模型使用`
                    : step.command.executor === "media.trim"
                      ? `剪辑已生成录像 ${step.command.start}–${step.command.end}秒，${step.command.aspect}画幅`
                      : step.title}
                </p>
                <p className="text-muted-foreground">
                  {step.expiresAt
                    ? `有效期至 ${new Date(step.expiresAt).toLocaleTimeString()}`
                    : "等待审批"}{" "}
                  · 本步骤不调用付费生成模型
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void operate(() => decide(step, "approve"))}
                  >
                    确认此动作
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void operate(() => decide(step, "reject"))}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            )}
            {step.state === "review" && (
              <div className="mt-2 space-y-2">
                <p>
                  上次执行结果不确定。核对下方证据后再继续，系统不会自动重复。
                </p>
                <details>
                  <summary>查看执行参数与回执</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(
                      { command: step.command, output: step.output },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void operate(() => decide(step, "observed_completed", true))
                  }
                >
                  已核实完成
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void operate(() =>
                      decide(step, "observed_not_completed", true),
                    )
                  }
                >
                  已核实未执行
                </Button>
              </div>
            )}
            {step.output && (
              <details className="mt-2">
                <summary>查看结果证据</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      {goal.result?.summary && (
        <div className="mt-4">
          <MarkdownRenderer text={goal.result.summary} />
        </div>
      )}
      {goal.result?.assets?.slice(0, 4).map((asset) =>
        typeof asset.id === "string" &&
        ["image", "video"].includes(String(asset.mediaType)) ? (
          <div className="mt-3" key={asset.id}>
            <AuthenticatedRecording
              assetId={asset.id}
              accessToken={token}
              kind={asset.mediaType as "image" | "video"}
              label="工作流结果"
            />
          </div>
        ) : null,
      )}
    </section>
  );
}

export function useWorkflowRun(
  token: string,
  goalId: string | null,
  onComplete?: (goal: AgentGoal) => void | Promise<void>,
) {
  const [goal, setGoal] = useState<AgentGoal | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    if (!goalId) return;
    const next = await fetchAgentGoal(token, goalId);
    setGoal(next);
    setError("");
  }
  useEffect(() => {
    if (!goalId) {
      setGoal(null);
      return;
    }
    let stopped = false,
      done = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await fetchAgentGoal(token, goalId);
        if (stopped) return;
        setGoal(next);
        setError("");
        if (next.status === "completed" && !done) {
          await onComplete?.(next);
          if (stopped) return;
          done = true;
          if (next.chatSessionId) {
            window.dispatchEvent(new CustomEvent("helstera:desktop-agent-result", {
              detail: { sessionId: next.chatSessionId },
            }));
          }
        }
        if (["completed", "failed", "canceled"].includes(next.status)) return;
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error ? cause.message : "无法读取运行状态。",
          );
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, goalId, onComplete]);
  return { goal, error, refresh };
}
