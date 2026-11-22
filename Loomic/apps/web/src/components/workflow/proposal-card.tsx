"use client";
import {productLabel} from "@/lib/product-label";
import { useEffect, useState } from "react";
import { ChevronDown, Check, Clock3 } from "lucide-react";
import {
  workflowChanges,
  WORKFLOW_ACTION_LABELS,
  validateWorkflow,
  compileWorkflow,
  workflowRunGraph,
  type WorkflowProposal,
} from "@helstera/shared";
import { useAuth } from "@/lib/auth-context";
import {
  decideWorkflowProposal,
  getWorkflowProposal,
  notifyWorkflowChanged,
  openCanvasWorkflow,
} from "@/lib/canvas-workflow-api";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { Button } from "@/components/ui/button";
import "./assistant.css";
import {workflowFieldNames,formatWorkflowValue} from "./config-values";
import { WorkflowProposalRun } from "./proposal-run";
import { resolveWorkflowEdits, selectWorkflowEdits, toggleWorkflowEdit, workflowEdits } from "@helstera/shared";
import { WorkflowEditSelection } from "./edit-selection";
import { WorkflowBudgetField, validWorkflowBudget } from "./budget-field";
function editSummary(status: WorkflowProposal["status"], selected: number, total: number): string {
  if (status === "applied") return `已应用 ${selected} 项修改`;
  if (status === "pending") return `已选 ${selected}/${total} 项修改`;
  return `${total} 项未应用的修改`;
}
export function WorkflowProposalCard({
  canvasId,
  id,
  initial,
  onApplied,
}: {
  canvasId: string;
  id: string;
  initial?: WorkflowProposal | undefined;
  onApplied?: (proposal: WorkflowProposal) => void;
}) {
  const { session } = useAuth(),
    [proposal, setProposal] = useState(initial ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [now, setNow] = useState(Date.now()),
    [retry, setRetry] = useState(0);
  const [budget,setBudget] = useState("0");
  const [editChoice, setEditChoice] = useState<{ id: string; requested: string[]; deletionConfirmed: boolean } | null>(null);
  useEffect(()=>setBudget("0"),[id]);
  useEffect(() => {
    if (initial) setProposal(initial);
  }, [initial]);
  useEffect(() => {
    if (!session?.access_token) return;
    let active = true;
    setError("");
    void getWorkflowProposal(session.access_token, canvasId, id)
      .then((item) => {
        if (active) setProposal(item);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [canvasId, id, session?.access_token, retry]);
  const decide = async (decision: "confirm" | "reject") => {
    if (!session?.access_token || busy) return;
    if (decision === "confirm" && proposal?.action === "run" && !validWorkflowBudget(budget)) {setError("请填写有效的流程预算上限。");return;}
    setBusy(true);
    setError("");
    try {
      const next = await decideWorkflowProposal(
        session.access_token,
        canvasId,
        id,
        decision,
        decision === "confirm" && proposal?.action === "run" ? Number(budget) : undefined,
        decision === "confirm" && proposal?.action === "edit" && selectedEdit ? { selectedChanges: selectedEdit.selectedChanges, deletionConfirmed: editChoice?.id === proposal.id && editChoice.deletionConfirmed } : undefined,
      );
      setProposal(next);
      if (next.status === "applied") {
        const workflowId =
          typeof next.result?.workflowId === "string"
            ? next.result.workflowId
            : next.workflowId;
        if (workflowId)
          notifyWorkflowChanged(
            workflowId,
            typeof next.result?.goalId === "string"
              ? next.result.goalId
              : undefined,
          );
        onApplied?.(next);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "操作失败，请刷新状态后重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!proposal)
    return (
      <div>
        <p role={error ? "alert" : "status"} className="text-xs">
          {error || "正在读取 AI 操作…"}
        </p>
        {error && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试读取
          </Button>
        )}
      </div>
    );
  const expired = Date.parse(proposal.expiresAt) <= now,
    changes = workflowChanges(proposal.before, proposal.graph),
    issues = proposal.graph ? validateWorkflow(proposal.graph) : [];
  let editError = "";
  let availableEdits: ReturnType<typeof workflowEdits> = [];
  let selectedEdit: ReturnType<typeof selectWorkflowEdits> | null = null;
  let requested: string[] = [];
  if (proposal.action === "edit" && proposal.graph) {
    try {
      availableEdits = workflowEdits(proposal.before, proposal.graph);
      const stored = Array.isArray(proposal.result?.selectedChanges) && proposal.result.selectedChanges.every(id => typeof id === "string") ? proposal.result.selectedChanges as string[] : null;
      requested = editChoice?.id === proposal.id ? editChoice.requested : stored ?? availableEdits.map(edit => edit.id);
      selectedEdit = selectWorkflowEdits(proposal.before, proposal.graph, requested);
    } catch (cause) { editError = cause instanceof Error ? cause.message : "所选改动无法应用。"; }
  }
  const selectedIds = resolveWorkflowEdits(availableEdits, requested);
  const proposalId = proposal.id;
  const previewGraph = proposal.status === "rejected" ? proposal.graph : selectedEdit?.graph ?? proposal.graph;
  const changesSummary = proposal.action === "edit" && availableEdits.length ? editSummary(proposal.status, selectedIds.length, availableEdits.length) : changes.length ? `${changes.length} 项修改` : "操作说明";
  function toggleEdit(id: string, checked: boolean) {
    setEditChoice({ id: proposalId, requested: toggleWorkflowEdit(availableEdits, requested, id, checked), deletionConfirmed: false });
  }
  function confirmDeletion(checked: boolean) { setEditChoice({ id: proposalId, requested, deletionConfirmed: checked }); }
  function selectAllEdits() { setEditChoice({ id: proposalId, requested: availableEdits.map(edit => edit.id), deletionConfirmed: false }); }
  function clearEdits() { setEditChoice({ id: proposalId, requested: [], deletionConfirmed: false }); }
  let scopeSteps:string[]=[];
  let scopeError="";
  if(proposal.targetNodeId){
    try{if(!proposal.before)throw new Error("缺少流程快照，请重新生成方案。");scopeSteps=compileWorkflow(workflowRunGraph(proposal.before,proposal.targetNodeId)).steps.map(step=>step.title);}
    catch(cause){scopeError=cause instanceof Error?cause.message:"无法核对执行范围。";}
  }
  return (
    <section className="workflow-proposal" data-status={proposal.status === "pending" && expired ? "expired" : proposal.status} aria-label="AI 工作流操作">
      <header>
        <strong>{WORKFLOW_ACTION_LABELS[proposal.action]}</strong>
        <span>
          {proposal.status === "applied" ? <Check size={12} aria-hidden /> : proposal.status === "pending" ? <Clock3 size={12} aria-hidden /> : null}
          {proposal.status === "applied"
            ? proposal.action === "inspect"
              ? "已读取"
              : "已应用"
            : proposal.status === "rejected"
              ? "已放弃"
              : expired
                ? "已过期"
                : "等待确认"}
        </span>
      </header>
      {proposal.targetNodeId&&<div className="workflow-partial-scope"><strong>执行到：{proposal.before?.nodes.find(node=>node.id===proposal.targetNodeId)?.title??proposal.targetNodeId}</strong><p>仅运行以下步骤，未固定上游会重新执行；固定结果复用，生成费用仍逐次确认。</p><ol>{scopeSteps.map((title,index)=><li key={index}>{title}</li>)}</ol>{scopeError&&<p role="alert">{scopeError}</p>}</div>}
      {previewGraph && (
        <strong className="text-xs">{productLabel(previewGraph.title)}</strong>
      )}
      <details className="workflow-proposal-details" open={proposal.status === "pending" || proposal.action === "inspect"}>
      <summary><span>{changesSummary}</span><ChevronDown size={14} aria-hidden /></summary>
      <div className="workflow-proposal-summary"><MarkdownRenderer text={proposal.summary} /></div>
      {proposal.revision !== null && (
        <p className="workflow-proposal-version">
          基于第 {proposal.revision} 版
          {proposal.before ? ` · ${productLabel(proposal.before.title)}` : ""}
        </p>
      )}
      {proposal.action === "edit" && proposal.status !== "rejected" && availableEdits.length > 0 ? <WorkflowEditSelection edits={availableEdits} selected={selectedIds} requested={requested} deletionConfirmed={editChoice?.id === proposal.id && editChoice.deletionConfirmed} disabled={busy || expired || proposal.status !== "pending"} pending={proposal.status === "pending"} toggle={toggleEdit} confirmDeletion={confirmDeletion} selectAll={selectAllEdits} clear={clearEdits} /> : !!changes.length && (
        <ul className="workflow-change-list">
          {changes.map((change, index) => (
            <li key={index} data-kind={change.kind}>
              <span>
                {change.kind === "add"
                  ? "＋"
                  : change.kind === "remove"
                    ? "−"
                    : "↳"}
              </span>
              <div>
                <strong>{change.title}</strong>
                <small>{change.detail}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editError && <p role="alert" className="text-xs text-destructive">{editError}</p>}
      {proposal.graph && (
        <details>
          <summary>检查节点参数与输入</summary>
          {(previewGraph ?? proposal.graph).nodes.map((node) => (
            <div className="workflow-proposal-node" key={node.id}>
              <strong>{node.title}</strong>
              <dl>
                {Object.entries(node.config)
                  .filter(([key]) => key !== "kind")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {workflowFieldNames[key] ?? key}
                      </dt>
                      <dd>
                        {key === "path" && node.config.kind === "split" && value === "" ? "整个数组" : formatWorkflowValue(value,key)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          ))}
        </details>
      )}
      {!!issues.length && (
        <p className="text-xs text-amber-700">
          可保存草稿；运行前还需完善：
          {issues.map((issue) => issue.message).join(" ")}
        </p>
      )}
      {proposal.action !== "inspect" && (
        <p className="workflow-proposal-note">
          {proposal.action === "edit"
            ? "应用只更新节点，运行需要另行确认。"
            : "确认仅作用于这次流程及运行；生成费用和录制动作仍需逐项确认。"}
        </p>
      )}
      </details>
      {proposal.action === "run" && proposal.status === "pending" && <WorkflowBudgetField value={budget} onChange={setBudget} disabled={busy}/>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {proposal.action === "run" &&
        proposal.status === "applied" &&
        session?.access_token &&
        typeof proposal.result?.goalId === "string" &&
        proposal.workflowId && (
          <WorkflowProposalRun
            token={session.access_token}
            goalId={proposal.result.goalId}
            workflowId={proposal.workflowId}
          />
        )}
      {proposal.status === "pending" ? (
        <footer>
          <Button
            size="sm"
            disabled={busy || expired || Boolean(scopeError) || Boolean(editError) || (proposal.action === "edit" && (!selectedEdit?.selectedChanges.length || (selectedEdit.destructive.length > 0 && !(editChoice?.id === proposal.id && editChoice.deletionConfirmed))))}
            onClick={() => void decide("confirm")}
          >
            {busy
              ? "处理中…"
              : proposal.action === "edit"
                ? "应用到画布"
                : `确认${WORKFLOW_ACTION_LABELS[proposal.action]}`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void decide("reject")}
          >
            暂不应用
          </Button>
        </footer>
      ) : proposal.workflowId ||
        typeof proposal.result?.workflowId === "string" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openCanvasWorkflow(
              String(proposal.result?.workflowId ?? proposal.workflowId),
            )
          }
        >
          查看画布流程
        </Button>
      ) : null}
    </section>
  );
}
