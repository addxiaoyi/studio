"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, ShieldCheck } from "lucide-react";
import type { WorkflowProposal } from "@helstera/shared";
import {
  askWorkflowAssistant,
  listWorkflowProposals,
} from "@/lib/canvas-workflow-api";
import { WorkflowProposalCard } from "./proposal-card";
import { Button } from "@/components/ui/button";
import "./assistant.css";
export function WorkflowAssistantChat({
  token,
  canvasId,
  workflowId,
  sessionId,
  selectedNodeIds,
  referenceIds,
  prompt,
  setPrompt,
  prepare,
  onApplied,
  children,
}: {
  token: string;
  canvasId: string;
  workflowId?: string | undefined;
  sessionId?: string | undefined;
  selectedNodeIds: string[];
  referenceIds: string[];
  prompt: string;
  setPrompt(text: string): void;
  prepare(): Promise<boolean>;
  onApplied(proposal: WorkflowProposal): void;
  children?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<WorkflowProposal[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const latest = useRef(0),
    key = useRef({ prompt: "", id: crypto.randomUUID() });
  useLayoutEffect(() => {
    // Loading saved history must not push the focused composer below the dock.
    const input = document.getElementById("workflow-ai-request");
    if (input && document.activeElement === input)
      input.closest("form")?.scrollIntoView({ block: "end" });
  }, [messages, loading]);
  useEffect(() => {
    let active = true;
    latest.current++;
    setMessages([]);
    setLoading(true);
    setError("");
    void listWorkflowProposals(token, canvasId, workflowId)
      .then((items) => {
        if (active) setMessages(items);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, canvasId, workflowId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError("");
    const epoch = latest.current,
      request = prompt.trim();
    try {
      if (!(await prepare()))
        throw new Error("先保存当前草稿，再让 AI 根据最新版本修改。");
      if (key.current.prompt !== request)
        key.current = { prompt: request, id: crypto.randomUUID() };
      const message = await askWorkflowAssistant(token, canvasId, {
        prompt: request,
        requestKey: key.current.id,
        ...(workflowId ? { workflowId } : {}),
        ...(sessionId ? { sessionId } : {}),
        selectedNodeIds,
        referenceElementIds: referenceIds,
      });
      if (epoch === latest.current) {
        setMessages((items) => [
          ...items.filter((item) => item.id !== message.id),
          message,
        ]);
        setPrompt("");
        key.current = { prompt: "", id: crypto.randomUUID() };
      }
    } catch (cause) {
      if (epoch === latest.current)
        setError(
          cause instanceof Error ? cause.message : "AI 暂时无法响应，请重试。",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workflow-assistant" aria-label="工作流 AI 对话">
      <header>
        <h3><Sparkles size={16} aria-hidden />和 AI 一起搭建</h3>
        <p>
          {workflowId
            ? "正在操作当前流程，可指定选中节点。"
            : "描述目标，AI 会先给出可检查的节点方案。"}
        </p>
      </header>
      {loading && <p role="status">正在读取对话…</p>}
      {!loading && !messages.length && (
        <div className="workflow-assistant-examples">
          {[
            "把故事拆成三个分镜，结果放回画布",
            "检查当前流程的问题并修复连接",
            "暂停当前流程",
            "查看失败原因，保留已完成步骤继续",
          ].map((text) => (
            <button type="button" key={text} onClick={() => setPrompt(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="workflow-assistant-history">
        {messages.map((message) => (
          <div key={message.id}>
            <div className="workflow-user-message"><small>你的要求</small><p className="workflow-user-request">{message.prompt}</p></div>
            <WorkflowProposalCard
              canvasId={canvasId}
              id={message.id}
              initial={message}
              onApplied={applied => {setMessages(items=>items.map(item=>item.id===applied.id?applied:item));onApplied(applied);}}
            />
          </div>
        ))}
      </div>
      <form className="workflow-assistant-compose" onSubmit={submit}>
        {children}
        <div className="workflow-compose-field">
        <label htmlFor="workflow-ai-request">让 AI 帮你搭建</label>
        <textarea
          id="workflow-ai-request"
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：把选中节点改成录制，再连接一个 5 秒裁剪节点"
          rows={3}
        />
        <div className="workflow-compose-actions"><span><ShieldCheck size={13} aria-hidden />先确认，再执行</span><Button type="submit" aria-label={busy ? "AI 正在检查流程…" : "发送给 AI"} disabled={busy || !prompt.trim()}><ArrowUp size={16} aria-hidden /><span>{busy ? "思考中…" : "发送"}</span></Button></div>
        </div>
        <p className="workflow-compose-note">运行、生成费用与录制仍需逐项确认。</p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
