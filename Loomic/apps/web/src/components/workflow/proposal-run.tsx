"use client";
import { useEffect, useState } from "react";
import { fetchAgentGoal } from "@/lib/server-api";
import { openCanvasWorkflow } from "@/lib/canvas-workflow-api";
import type { AgentGoal } from "@helstera/shared";
import { Button } from "@/components/ui/button";
export function WorkflowProposalRun({
  token,
  goalId,
  workflowId,
}: {
  token: string;
  goalId: string;
  workflowId: string;
}) {
  const [goal, setGoal] = useState<AgentGoal | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await fetchAgentGoal(token, goalId);
        if (!active) return;
        setGoal(next);
        setError("");
        if (!["completed", "failed", "canceled"].includes(next.status))
          timer = setTimeout(() => void refresh(), 3000);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "运行状态读取失败。",
          );
          timer = setTimeout(() => void refresh(), 5000);
        }
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, goalId]);
  return (
    <div
      className="rounded-lg bg-muted p-2 text-xs"
      aria-label="AI 工作流运行状态"
    >
      {goal ? (
        <>
          <p>
            {
              (
                {
                  running: "执行中",
                  paused: "已暂停",
                  completed: "已完成",
                  waiting_approval: "等待逐项确认",
                  waiting_desktop: "等待执行器",
                  failed: "执行失败",
                  canceled: "已取消",
                  draft: "待运行",
                } as Record<string, string>
              )[goal.status]
            }{" "}
            ·{" "}
            {goal.executionSteps?.filter((step) => step.state === "succeeded")
              .length ?? 0}
            /{goal.plan.steps.length} 步
          </p>
          {goal.executionSteps
            ?.filter(
              (step) => step.state === "failed" || step.state === "review",
            )
            .map((step) => (
              <p className="mt-2" key={step.id}>
                {step.title}：{step.error ?? "需要核验执行结果"}
              </p>
            ))}
        </>
      ) : (
        <p role="status">正在读取运行状态…</p>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        className="mt-2"
        size="sm"
        variant="outline"
        onClick={() => openCanvasWorkflow(workflowId)}
      >
        查看执行步骤与审批
      </Button>
    </div>
  );
}
