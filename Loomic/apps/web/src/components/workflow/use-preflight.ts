"use client";
import { inspectCanvasWorkflow } from "@/lib/canvas-workflow-api";
import type { WorkflowGraph, WorkflowPreflight } from "@helstera/shared";
import { useEffect, useState } from "react";

type Options = {
  open: boolean;
  token: string;
  canvasId: string;
  workflowId?: string | undefined;
  revision?: number | undefined;
  graph: WorkflowGraph;
  targetNodeId?: string | undefined;
};
type Check = {
  key: string;
  report: WorkflowPreflight | null;
  error: string;
  checking: boolean;
};

export function useWorkflowPreflight(options: Options) {
  const { open, token, canvasId, workflowId, revision, graph, targetNodeId } =
    options;
  const [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<Check>({
    key: "",
    report: null,
    error: "",
    checking: false,
  });
  const key = JSON.stringify([
    token,
    canvasId,
    workflowId,
    revision,
    graph,
    targetNodeId,
    attempt,
  ]);
  useEffect(() => {
    if (!open || !workflowId || !revision) return;
    const controller = new AbortController();
    let alive = true;
    setCheck({ key, report: null, error: "", checking: true });
    void inspectCanvasWorkflow(
      token,
      canvasId,
      workflowId,
      revision,
      graph,
      targetNodeId,
      controller.signal,
    )
      .then((report) => {
        if (alive) setCheck({ key, report, error: "", checking: false });
      })
      .catch((cause) => {
        if (alive)
          setCheck({
            key,
            report: null,
            error:
              cause instanceof Error
                ? cause.message
                : "运行前检查失败，请重试。",
            checking: false,
          });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, key, token, canvasId, workflowId, revision, graph, targetNodeId]);
  function retry() {
    setAttempt((value) => value + 1);
  }
  const current =
    open && key === check.key
      ? check
      : { report: null, error: "", checking: open };
  return { ...current, retry };
}
