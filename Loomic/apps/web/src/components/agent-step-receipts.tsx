"use client";
import { useState } from "react";
import type { AgentGoal } from "@helstera/shared";
import { getServerBaseUrl } from "@/lib/env";
import { AuthenticatedRecording } from "./chat/authenticated-recording";

export function AgentStepReceipts({ goal, token, refresh }: { goal: AgentGoal; token: string; refresh(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const decide = async (id: string, path: string, body: unknown) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${getServerBaseUrl()}/api/agent/goals/${goal.id}/steps/${id}/${path}`, { method: "POST", credentials: "include", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "步骤处理失败，请刷新后重试。");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "步骤处理失败。"); }
    finally { setBusy(false); }
  };
  if (!goal.executionSteps?.length) return null;
  return <section className="agent-workspace-section" aria-label="步骤执行与审批">
    <h3>步骤执行与审批</h3>
    {goal.executionSteps.map(step => <article key={step.id} className="my-2 space-y-2 rounded-md border p-3">
      <strong>{step.title}</strong><p className="text-xs">{({ queued: "排队中", running: "执行中", waiting_approval: "等待审批", waiting_desktop: "等待桌面回执", review: "需要人工核验", succeeded: "已完成", failed: "失败", canceled: "已取消" })[step.state]} · 尝试 {step.attempt}</p>
      <details><summary>查看动作与证据</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ action: step.command, evidence: step.output }, null, 2)}</pre></details>
      {step.executor === "media.trim" && step.state === "succeeded" && typeof step.output?.recordingAssetId === "string" && <AuthenticatedRecording assetId={step.output.recordingAssetId} accessToken={token} maxBytes={250 * 1024 * 1024} label="目标剪辑成片" />}
      {step.error && <p role="alert">{step.error}</p>}
      {step.state === "waiting_approval" && <><p className="text-xs">本次操作 0 积分 · 有效期至 {step.expiresAt ? new Date(step.expiresAt).toLocaleString() : "—"}</p><div className="flex gap-2"><button disabled={busy} onClick={() => void decide(step.id, "decision", { decision: "approve", fingerprint: step.fingerprint })}>批准此动作</button><button disabled={busy} onClick={() => void decide(step.id, "decision", { decision: "reject", fingerprint: step.fingerprint })}>拒绝</button></div></>}
      {step.state === "review" && <div className="flex gap-2"><button disabled={busy || !step.output} onClick={() => void decide(step.id, "review", { outcome: "observed_completed" })}>证据确认已完成</button><button disabled={busy} onClick={() => void decide(step.id, "review", { outcome: "observed_not_completed" })}>确认未完成，重新审批</button></div>}
    </article>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
