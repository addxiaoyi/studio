"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../../lib/auth-context";
import {
  approveAgentWorkflow,
  fetchAgentWorkflow,
  fetchJob,
  retryAgentWorkflow,
  type AgentWorkflowView,
} from "../../lib/server-api";

type WorkflowStep = {
  id: string;
  title: string;
  status: string;
  retryable?: boolean;
  output?: Record<string, unknown>;
  error?: string;
};

type WorkflowPlan = {
  steps: WorkflowStep[];
  approvalGate?: { required?: boolean; reason?: string; stepId?: string };
};

type WorkflowJob = {
  id: string;
  status: string;
  progress?: number;
  stage?: string | null;
  error_message?: string | null;
};

export function AgentWorkflowCard({ workflowId }: { workflowId: string }) {
  const { session } = useAuth();
  const [workflow, setWorkflow] = useState<AgentWorkflowView | null>(null);
  const [job, setJob] = useState<WorkflowJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const plan = useMemo(() => readPlan(workflow?.plan), [workflow?.plan]);
  const approvalStep = plan.approvalGate?.stepId
    ? plan.steps.find((step) => step.id === plan.approvalGate?.stepId)
    : plan.steps.find((step) => step.status === "awaiting_approval");
  const generatedJobId = plan.steps
    .flatMap((step) => (step.output ? [step.output] : []))
    .map((output) => output.jobId)
    .find((value): value is string => typeof value === "string");
  const workflowTerminal = workflow?.status === "completed" || workflow?.status === "failed";
  const jobTerminal = job && ["succeeded", "failed", "dead_letter", "canceled"].includes(job.status);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const next = await fetchAgentWorkflow(session.access_token, workflowId);
      setWorkflow(next);
      setError(undefined);
      const jobId = findJobId(next) ?? generatedJobId;
      if (jobId) {
        const nextJob = await fetchJob(session.access_token, jobId);
        setJob(nextJob.job as WorkflowJob);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow status could not be loaded.");
    }
  }, [generatedJobId, session?.access_token, workflowId]);

  useEffect(() => {
    if (!session?.access_token) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      await load();
      if (!stopped) timer = window.setTimeout(() => void poll(), workflowTerminal && jobTerminal ? 8_000 : 2_000);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobTerminal, load, session?.access_token, workflowTerminal]);

  const approve = async () => {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setWorkflow(await approveAgentWorkflow(session.access_token, workflowId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow approval failed.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setWorkflow(await retryAgentWorkflow(session.access_token, workflowId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow retry failed.");
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = workflow?.status === "paused"
    ? "等待确认"
    : workflow?.status === "running"
      ? "执行中"
      : workflow?.status === "completed"
        ? "已完成"
        : workflow?.status === "failed"
          ? "执行失败"
          : "准备中";

  return (
    <section className="rounded-xl border border-info/30 bg-info/5 p-4" aria-label="Agent workflow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Agent 工作流</h3>
          <p className="mt-1 text-xs text-muted-foreground">{approvalStep?.title ?? currentStepTitle(plan)}</p>
        </div>
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
      </div>

      {workflow?.status === "paused" && approvalStep && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <p>{plan.approvalGate?.reason ?? "该步骤需要确认后继续。"}</p>
          <button type="button" onClick={approve} disabled={busy} className="mt-3 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50">
            {busy ? "处理中" : "确认并继续"}
          </button>
        </div>
      )}

      {job && (
        <div className="mt-3 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">生成任务</span>
            <span className={job.status === "succeeded" ? "text-success" : job.status === "failed" || job.status === "dead_letter" ? "text-destructive" : "text-foreground"}>
              {job.status}
            </span>
          </div>
          {job.stage && <p className="mt-1 text-muted-foreground">{job.stage}</p>}
          {typeof job.progress === "number" && !jobTerminal && <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/60 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div>}
          {job.error_message && <p role="alert" className="mt-2 text-destructive">{job.error_message}</p>}
        </div>
      )}

      {workflow?.status === "failed" && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <span className="text-destructive">{failedStep(plan)?.error ?? "工作流执行失败。"}</span>
          {failedStep(plan)?.retryable && <button type="button" onClick={retry} disabled={busy} className="shrink-0 rounded-lg border border-border px-3 py-2 text-foreground disabled:opacity-50">重试步骤</button>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function readPlan(value: Record<string, unknown> | undefined): WorkflowPlan {
  const rawSteps = Array.isArray(value?.steps) ? value.steps : [];
  const steps = rawSteps.filter(isRecord).map((step) => ({
    id: typeof step.id === "string" ? step.id : "unknown",
    title: typeof step.title === "string" ? step.title : "工作流步骤",
    status: typeof step.status === "string" ? step.status : "pending",
    ...(typeof step.retryable === "boolean" ? { retryable: step.retryable } : {}),
    ...(isRecord(step.output) ? { output: step.output } : {}),
    ...(typeof step.error === "string" ? { error: step.error } : {}),
  }));
  const gate = isRecord(value?.approvalGate) ? value.approvalGate : undefined;
  return {
    steps,
    ...(gate ? { approvalGate: {
      ...(typeof gate.required === "boolean" ? { required: gate.required } : {}),
      ...(typeof gate.reason === "string" ? { reason: gate.reason } : {}),
      ...(typeof gate.stepId === "string" ? { stepId: gate.stepId } : {}),
    } } : {}),
  };
}

function findJobId(workflow: AgentWorkflowView) {
  const plan = readPlan(workflow.plan);
  return plan.steps.flatMap((step) => (step.output?.jobId ? [step.output.jobId] : [])).find((value): value is string => typeof value === "string");
}

function currentStepTitle(plan: WorkflowPlan) {
  return plan.steps.find((step) => step.status === "running" || step.status === "awaiting_approval")?.title ?? "整理工作计划";
}

function failedStep(plan: WorkflowPlan) {
  return plan.steps.find((step) => step.status === "failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
