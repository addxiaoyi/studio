"use client";
import { useEffect, useRef, useState } from "react";
import { retainWorkflowLayout } from "./scene";
import { workflowGraphKey } from "./graph-state";
import {
  websiteWorkflow,
  workflowGraphSchema,
  type WorkflowGraph,
  type WorkflowDocument,
} from "@helstera/shared";
import {
  createCanvasWorkflow,
  listCanvasWorkflows,
  planCanvasWorkflow,
  runCanvasWorkflow,
  saveCanvasWorkflow,
  restoreWorkflowVersion,
} from "@/lib/canvas-workflow-api";

export function useCanvasWorkflow(
  token: string,
  canvasId: string,
  userId: string,
  initialId?: string,
) {
  const [documents, setDocuments] = useState<WorkflowDocument[]>([]),
    [selected, setSelected] = useState<WorkflowDocument | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph>(websiteWorkflow()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [enabled, setEnabled] = useState(false);
  const [proposal, setProposal] = useState<{
    graph: WorkflowGraph;
    summary: string;
  } | null>(null);
  const [undo, setUndo] = useState<WorkflowGraph[]>([]),
    [redo, setRedo] = useState<WorkflowGraph[]>([]);
  const [recovery, setRecovery] = useState<WorkflowGraph | null>(null),
    [prompt, setPrompt] = useState("");
  const [goalId, setGoalId] = useState<string | null>(null);
  const lock = useRef(false),
    version = useRef(0),
    key = useRef(crypto.randomUUID());
  const dirty = selected
    ? workflowGraphKey(graph) !== workflowGraphKey(selected.graph)
    : false;
  const draftKey = (id: string) => `loomic:workflow:${userId}:${id}`;
  function select(document: WorkflowDocument,positions?:WorkflowGraph) {
    setError("");
    setSelected(document);
    setGraph(positions??document.graph);
    setGoalId(document.activeGoalId);
    setUndo([]);
    setRedo([]);
    setProposal(null);
    setRecovery(null);
    setNotice("");
    key.current = crypto.randomUUID();
    version.current++;
    try {
      const raw = localStorage.getItem(draftKey(document.id));
      if (raw) {
        const saved = workflowGraphSchema.parse(JSON.parse(raw));
        if (workflowGraphKey(saved) !== workflowGraphKey(document.graph))
          setRecovery(saved);
      }
    } catch {
      setError("本机恢复草稿无法读取，服务器版本已打开。");
    }
  }
  async function load(preferred?: string) {
    const next = await listCanvasWorkflows(token, canvasId);
    setDocuments(next.workflows);
    setEnabled(next.executionEnabled);
    const candidate =
      next.workflows.find((doc) => doc.id === preferred) ?? next.workflows[0];
    if (candidate) select(candidate);
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void listCanvasWorkflows(token, canvasId)
      .then((next) => {
        if (!alive) return;
        setDocuments(next.workflows);
        setEnabled(next.executionEnabled);
        const doc =
          next.workflows.find((doc) => doc.id === initialId) ??
          next.workflows[0];
        if (doc) select(doc);
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canvasId, initialId]);
  useEffect(() => {
    if (!selected) return;
    try {
      if(!dirty){if(!recovery)localStorage.removeItem(draftKey(selected.id));return;}
      localStorage.setItem(draftKey(selected.id), JSON.stringify(graph));
    } catch {
      setError("本机草稿写入失败，请保存到工作区后再关闭页面。");
    }
  }, [graph, dirty, selected?.id, userId, recovery]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function edit(next: WorkflowGraph, checkpoint = true) {
    if(workflowGraphKey(next)===workflowGraphKey(graph))return;
    if (checkpoint) setUndo((history) => [...history.slice(-29), graph]);
    setRedo([]);
    setGraph(next);
    setProposal(null);
    version.current++;
  }
  function checkpoint() {
    setUndo((history) => [...history.slice(-29), graph]);
    setRedo([]);
  }
  function undoEdit() {
    const previous = undo.at(-1);
    if (previous) {
      setUndo(undo.slice(0, -1));
      setRedo([...redo, graph]);
      setGraph(previous);
      version.current++;
    }
  }
  function redoEdit() {
    const next = redo.at(-1);
    if (next) {
      setRedo(redo.slice(0, -1));
      setUndo([...undo, graph]);
      setGraph(next);
      version.current++;
    }
  }
  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作流操作失败。");
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function create(record = false, initial?: WorkflowGraph) {
    await run(async () => {
      const doc = await createCanvasWorkflow(
        token,
        canvasId,
        initial ?? websiteWorkflow(record),
        crypto.randomUUID(),
      );
      setDocuments((current) => [doc, ...current]);
      select(doc);
    });
  }
  async function save() {
    return run(async () => {
      if (!selected) return null;
      if (recovery) throw new Error("先选择恢复本机草稿或使用服务器版本，再保存。");
      const savingVersion = version.current;
      const doc = await saveCanvasWorkflow(
        token,
        canvasId,
        selected.id,
        selected.revision,
        graph,
      );
      setSelected(doc);
      setGoalId(null);
      setDocuments((current) =>
        current.map((item) => (item.id === doc.id ? doc : item)),
      );
      if (version.current === savingVersion) localStorage.removeItem(draftKey(doc.id));
      setNotice("工作流已保存");
      return doc;
    });
  }
  async function askAi(referenceElementIds?:string[]) {
    await run(async () => {
      const current = version.current;
      const suggestion = await planCanvasWorkflow(
        token,
        canvasId,
        prompt,
        selected ? graph : undefined,
        referenceElementIds,
      );
      if (current !== version.current)
        throw new Error("生成期间流程已改变，请重新生成方案。");
      setProposal(suggestion);
    });
  }
  async function applyProposal() {
    if (!proposal) return;
    const proposed = proposal;
    await run(async () => {
      if (selected) {
        edit(retainWorkflowLayout(proposed.graph, graph));
        setNotice("AI 方案已应用到草稿，请检查并保存。");
      } else {
        const doc = await createCanvasWorkflow(
          token,
          canvasId,
          proposed.graph,
          crypto.randomUUID(),
        );
        setDocuments((current) => [doc, ...current]);
        select(doc);
      }
      setProposal(null);
    });
  }
  async function start(sessionId?: string, targetNodeId?: string, budgetCredits?: number) {
    return run(async () => {
      if (!selected || dirty) throw new Error("请先保存当前流程。");
      const receipt = await runCanvasWorkflow(
        token,
        canvasId,
        selected.id,
        selected.revision,
        key.current,
        sessionId,
        targetNodeId,
        budgetCredits,
      );
      setGoalId(receipt.goalId);
      setSelected((current) =>
        current ? { ...current, activeGoalId: receipt.goalId } : current,
      );
      key.current = crypto.randomUUID();
      setNotice("流程已开始，按节点依赖依次执行。");
      return receipt;
    });
  }
  return {
    documents,
    selected,
    graph,
    error,
    notice,
    busy,
    loading,
    enabled,
    dirty,
    proposal,
    prompt,
    setPrompt,
    setProposal,
    undo,
    redo,
    goalId,
    recovery,
    select,
    edit,
    checkpoint,
    undoEdit,
    redoEdit,
    create,
    save,
    restoreVersion: (revision:number) => run(async()=>{
      if(!selected)throw new Error("先选择工作流。");
      if(dirty||recovery)throw new Error("先保存当前草稿，再恢复版本。");
      const restored=await restoreWorkflowVersion(token,canvasId,selected.id,selected.revision,revision);
      localStorage.removeItem(draftKey(restored.id));
      setDocuments(current=>current.map(doc=>doc.id===restored.id?restored:doc));
      select(restored);
      setNotice(`已恢复第 ${revision} 版，另存为第 ${restored.revision} 版。`);
      return restored;
    }),
    askAi,
    applyProposal,
    start,
    refresh: (preferred?:string) => run(() => {if(dirty)throw new Error("当前有未保存修改，请先保存或保留本机草稿后切换。");return load(preferred??selected?.id);}),
    clearRecovery: () => {
      if (selected) localStorage.removeItem(draftKey(selected.id));
      setRecovery(null);
    },
    restoreRecovery: () => {
      if (recovery) edit(recovery);
      setRecovery(null);
    },
    setError,
    setGoalId,
  };
}
