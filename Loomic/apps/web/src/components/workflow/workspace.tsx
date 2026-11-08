"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  type NodeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import {
  GitBranch,
  LayoutGrid,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  WORKFLOW_LABELS,
  compileWorkflow,
  connectionIssue,
  layoutWorkflow,
  validateWorkflow,
  type WorkflowNode,
} from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import { fetchWorkflowRuns } from "@/lib/canvas-workflow-api";
import { WorkflowNodeCard, type FlowNode } from "./node-card";
import { NodeInspector } from "./node-inspector";
import { useCanvasWorkflow } from "./use-workflow";
import { WorkflowRunPanel, useWorkflowRun } from "./run-panel";
import "./workflow.css";

const nodeTypes = { workflow: WorkflowNodeCard };
type Props = {
  token: string;
  canvasId: string;
  sessionId?: string | undefined;
  initialId?: string | undefined;
  onClose(): void;
  onCanvasSync(): void;
};
const initialConfigs: Record<
  WorkflowNode["config"]["kind"],
  WorkflowNode["config"]
> = {
  url: { kind: "url", url: "" },
  search: { kind: "search", query: "" },
  capture: { kind: "capture", record: false, pageLimit: 1 },
  trim: { kind: "trim", start: 0, end: 5, aspect: "original" },
  deliver: { kind: "deliver" },
};
export function WorkflowWorkspace({
  token,
  canvasId,
  sessionId,
  initialId,
  onClose,
  onCanvasSync,
}: Props) {
  const { session } = useAuth();
  const { resolvedTheme } = useTheme();
  const flow = useCanvasWorkflow(
    token,
    canvasId,
    session?.user.id ?? "",
    initialId,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [confirmRun, setConfirmRun] = useState(false);
  const run = useWorkflowRun(token, flow.goalId, onCanvasSync);
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof fetchWorkflowRuns>>
  >([]);
  useEffect(() => {
    if (!flow.selected) {
      setHistory([]);
      return;
    }
    let alive = true;
    void fetchWorkflowRuns(token, canvasId, flow.selected.id)
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch((error) => {
        if (alive) flow.setError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [token, canvasId, flow.selected?.id, flow.goalId, run.goal?.status]);
  const active = Boolean(
    run.goal && !["completed", "failed", "canceled"].includes(run.goal.status),
  );
  const locked = flow.busy || active;
  const issues = useMemo(() => validateWorkflow(flow.graph), [flow.graph]);
  const currentRun =
    !flow.dirty &&
    history.find((item) => item.goalId === flow.goalId)?.revision ===
      flow.selected?.revision;
  const nodes = useMemo<FlowNode[]>(
    () =>
      flow.graph.nodes.map((node) => ({
        id: node.id,
        type: "workflow",
        position: node.position,
        selected: node.id === selectedId,
        data: {
          node,
          status: currentRun
            ? (run.goal?.executionSteps?.find((step) => step.stepId === node.id)
                ?.state ??
              (node.config.kind === "url" && run.goal ? "succeeded" : "draft"))
            : "draft",
          ...(issues.find((issue) => issue.nodeId === node.id)
            ? {
                issue: issues.find((issue) => issue.nodeId === node.id)!
                  .message,
              }
            : {}),
        },
      })),
    [flow.graph, selectedId, run.goal, issues, currentRun],
  );
  const edges = useMemo(
    () =>
      flow.graph.edges.map((edge) => ({
        ...edge,
        type: "smoothstep",
        ariaLabel: `${flow.graph.nodes.find((node) => node.id === edge.source)?.title}到${flow.graph.nodes.find((node) => node.id === edge.target)?.title}`,
        style: { strokeWidth: 2 },
      })),
    [flow.graph],
  );
  const selected = flow.graph.nodes.find((node) => node.id === selectedId);
  const updateNodes = (changes: NodeChange<FlowNode>[]) => {
    if (locked) return;
    const structural = changes.filter(
      (change) => change.type === "position" || change.type === "remove",
    );
    if (!structural.length) return;
    const updated = applyNodeChanges(structural, nodes),
      ids = new Set(updated.map((node) => node.id));
    flow.edit(
      {
        ...flow.graph,
        nodes: updated.map((node) => ({
          ...node.data.node,
          position: node.position,
        })),
        edges: flow.graph.edges.filter(
          (edge) => ids.has(edge.source) && ids.has(edge.target),
        ),
      },
      false,
    );
  };
  function connect(source: string, target: string) {
    const issue = connectionIssue(flow.graph, source, target);
    if (issue) {
      flow.setError(issue);
      return;
    }
    flow.edit({
      ...flow.graph,
      edges: [
        ...flow.graph.edges,
        { id: `edge-${crypto.randomUUID()}`, source, target },
      ],
    });
  }
  function addNode(kind: string) {
    if (locked || !flow.selected) return;
    const type = kind as WorkflowNode["config"]["kind"];
    const node: WorkflowNode = {
      id: `node-${crypto.randomUUID()}`,
      title: WORKFLOW_LABELS[type],
      config: structuredClone(initialConfigs[type]),
      position: {
        x: (flow.graph.nodes.length % 4) * 290,
        y: Math.floor(flow.graph.nodes.length / 4) * 200 + 220,
      },
    };
    flow.edit({ ...flow.graph, nodes: [...flow.graph.nodes, node] });
    setSelectedId(node.id);
  }
  function removeNode(id: string) {
    flow.edit({
      ...flow.graph,
      nodes: flow.graph.nodes.filter((node) => node.id !== id),
      edges: flow.graph.edges.filter(
        (edge) => edge.source !== id && edge.target !== id,
      ),
    });
    setSelectedId(null);
  }
  function align() {
    try {
      flow.edit(layoutWorkflow(flow.graph));
    } catch (cause) {
      flow.setError(
        cause instanceof Error ? cause.message : "连线有误，暂不能排列。",
      );
    }
  }
  function close() {
    if (flow.dirty) {
      flow.setError(
        "请先保存草稿；也可以重新加载服务器版本后退出。本机恢复副本已保留。",
      );
      return;
    }
    onClose();
  }
  const proposal = flow.proposal;
  let plan: ReturnType<typeof compileWorkflow> | null = null;
  try {
    plan = compileWorkflow(flow.graph);
  } catch {
    /* Validation issues are shown beside the graph. */
  }
  const refreshRun = useCallback(() => run.refresh(), [run.refresh]);
  return (
    <section className="workflow-workspace" aria-label="可视化工作流">
      <header className="workflow-header">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch size={19} />
          <div>
            <h2 className="font-semibold">画布工作流</h2>
            <p className="text-xs text-muted-foreground">
              连接节点，让创作按你的逻辑执行
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={close}
          aria-label="返回创意画布"
        >
          <X size={18} />
        </Button>
      </header>
      <div className="workflow-toolbar">
        <div className="w-52 max-w-full">
          <StyledSelect
            aria-label="选择工作流"
            value={flow.selected?.id ?? ""}
            disabled={flow.busy || flow.dirty}
            options={[
              { value: "", label: "选择已保存的流程" },
              ...flow.documents.map((doc) => ({
                value: doc.id,
                label: doc.graph.title,
              })),
            ]}
            onChange={(id) => {
              const doc = flow.documents.find((doc) => doc.id === id);
              if (doc) flow.select(doc);
            }}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={flow.busy || flow.dirty}
          onClick={() => void flow.create()}
        >
          <Plus size={14} />
          新建
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!flow.selected || locked || !flow.dirty}
          onClick={() => void flow.save()}
        >
          <Save size={14} />
          {flow.busy ? "处理中…" : flow.dirty ? "保存草稿" : "已保存"}
        </Button>
        <span className="workflow-toolbar-divider" />
        <Button
          size="icon"
          variant="ghost"
          disabled={locked || !flow.undo.length}
          onClick={flow.undoEdit}
          aria-label="撤销工作流修改"
        >
          <Undo2 size={16} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={locked || !flow.redo.length}
          onClick={flow.redoEdit}
          aria-label="重做工作流修改"
        >
          <Redo2 size={16} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || !flow.selected}
          onClick={align}
        >
          <LayoutGrid size={14} />
          自动排列
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={
            locked || flow.dirty || !plan || !flow.selected || !flow.enabled
          }
          onClick={() => setConfirmRun(true)}
        >
          <Play size={14} />
          运行流程
        </Button>
      </div>
      {(flow.error || run.error) && (
        <div role="alert" className="workflow-banner is-error">
          {flow.error || run.error}
          <button onClick={() => void flow.refresh()} disabled={flow.busy}>
            重新加载
          </button>
        </div>
      )}
      {flow.notice && (
        <p role="status" className="workflow-banner">
          {flow.notice}
        </p>
      )}
      {flow.recovery && (
        <div className="workflow-banner">
          发现未保存的本机草稿。
          <button onClick={flow.restoreRecovery} disabled={active}>
            恢复草稿
          </button>
          <button onClick={flow.clearRecovery}>使用服务器版本</button>
        </div>
      )}
      {!flow.enabled && !flow.loading && (
        <p className="workflow-banner">
          执行服务尚未启用，可以先搭建并保存流程。
        </p>
      )}
      <div className="workflow-body">
        <div className="workflow-main">
          {!flow.selected ? (
            <div className="workflow-empty">
              <GitBranch size={36} className="text-muted-foreground" />
              <h3 className="mt-4 text-xl font-semibold">把想法连接成流程</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                从网址开始，连接浏览、录制与剪辑节点，最后把结果送回画布。也可以直接告诉
                AI 你的目标。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button
                  disabled={flow.busy || flow.loading}
                  onClick={() => void flow.create(false)}
                >
                  网站研究与截图
                </Button>
                <Button
                  disabled={flow.busy || flow.loading}
                  variant="outline"
                  onClick={() => void flow.create(true)}
                >
                  网站录制流程
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="workflow-palette">
                <StyledSelect
                  aria-label="添加节点"
                  value=""
                  disabled={locked || flow.graph.nodes.length >= 24}
                  onChange={addNode}
                  options={[
                    { value: "", label: "＋ 添加节点" },
                    ...Object.entries(WORKFLOW_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    ),
                  ]}
                />
                <label className="min-w-0 flex-1">
                  <span className="sr-only">流程名称</span>
                  <input
                    className="workflow-title"
                    value={flow.graph.title}
                    maxLength={120}
                    disabled={locked}
                    onChange={(event) =>
                      flow.edit({
                        ...flow.graph,
                        title: event.target.value || "未命名工作流",
                      })
                    }
                  />
                </label>
                <span className="text-xs text-muted-foreground">
                  {flow.graph.nodes.length} 个节点
                </span>
              </div>
              <div className="workflow-graph">
                <ReactFlow<FlowNode>
                  key={flow.selected.id}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={updateNodes}
                  onNodeDragStart={flow.checkpoint}
                  onNodeClick={(_event, node) => setSelectedId(node.id)}
                  onPaneClick={() => setSelectedId(null)}
                  onEdgesDelete={(deleted) => {
                    if (!locked)
                      flow.edit({
                        ...flow.graph,
                        edges: flow.graph.edges.filter(
                          (edge) =>
                            !deleted.some((item) => item.id === edge.id),
                        ),
                      });
                  }}
                  onConnect={(connection: Connection) =>
                    connect(connection.source, connection.target)
                  }
                  isValidConnection={(connection) =>
                    !connectionIssue(
                      flow.graph,
                      connection.source,
                      connection.target,
                    )
                  }
                  nodesDraggable={!locked}
                  nodesConnectable={!locked}
                  elementsSelectable
                  deleteKeyCode={locked ? null : ["Backspace", "Delete"]}
                  fitView
                  minZoom={0.25}
                  maxZoom={1.5}
                  colorMode={resolvedTheme === "dark" ? "dark" : "light"}
                  proOptions={{ hideAttribution: true }}
                  ariaLabelConfig={{
                    "controls.zoomIn.ariaLabel": "放大工作流",
                    "controls.zoomOut.ariaLabel": "缩小工作流",
                    "controls.fitView.ariaLabel": "适应全部节点",
                  }}
                >
                  <Background gap={22} size={1} />
                  <Controls showInteractive={false} />
                  <MiniMap
                    pannable
                    zoomable
                    nodeColor="var(--muted-foreground)"
                    maskColor="transparent"
                  />
                </ReactFlow>
              </div>
            </>
          )}
          <form
            className="workflow-ai"
            onSubmit={(event) => {
              event.preventDefault();
              void flow.askAi();
            }}
          >
            <label htmlFor="workflow-ai-request">
              <Sparkles size={16} />让 AI 帮你搭建
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="workflow-ai-request"
                value={flow.prompt}
                onChange={(event) => flow.setPrompt(event.target.value)}
                rows={2}
                maxLength={3000}
                placeholder="例如：浏览这个网站，录制介绍，再裁剪前 5 秒并保存到画布"
                disabled={locked}
              />
              <Button type="submit" disabled={locked || !flow.prompt.trim()}>
                {flow.busy ? "生成中…" : "生成方案"}
              </Button>
            </div>
            <p>AI 先生成可检查的节点方案，应用到草稿后由你运行。</p>
          </form>
        </div>
        <aside className="workflow-sidebar" aria-label="工作流检查与运行">
          {history.length > 0 && (
            <div className="border-b p-3">
              <StyledSelect
                aria-label="查看运行历史"
                value={flow.goalId ?? ""}
                options={[
                  { value: "", label: "选择运行记录" },
                  ...history.map((item) => ({
                    value: item.goalId,
                    label: `第${item.revision}版 · ${new Date(item.createdAt).toLocaleString()}`,
                  })),
                ]}
                onChange={(id) => flow.setGoalId(id || null)}
              />
            </div>
          )}
          {run.goal && (
            <WorkflowRunPanel
              token={token}
              goal={run.goal}
              onRefresh={refreshRun}
            />
          )}
          {selected && (
            <NodeInspector
              node={selected}
              graph={flow.graph}
              disabled={locked}
              onChange={(node) =>
                flow.edit({
                  ...flow.graph,
                  nodes: flow.graph.nodes.map((item) =>
                    item.id === node.id ? node : item,
                  ),
                })
              }
              onConnect={connect}
              onDisconnect={(id) =>
                flow.edit({
                  ...flow.graph,
                  edges: flow.graph.edges.filter((edge) => edge.id !== id),
                })
              }
              onDelete={removeNode}
            />
          )}
          {!selected && !run.goal && (
            <div className="p-5">
              <p className="text-sm font-semibold">选中节点查看参数</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                拖动节点整理布局，连接输入与输出。也可在节点设置中选择上游节点完成键盘操作。
              </p>
            </div>
          )}
          {flow.selected && issues.length > 0 && (
            <div className="workflow-validation">
              <h3 className="text-sm font-semibold">
                运行前完善 {issues.length} 项
              </h3>
              <ul className="mt-2 space-y-2">
                {issues.map((issue, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(issue.nodeId ?? null)}
                      className="text-left text-xs leading-5 text-destructive"
                    >
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      <Dialog
        open={Boolean(proposal)}
        onOpenChange={(open) => {
          if (!open) flow.setProposal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>检查 AI 工作流方案</DialogTitle>
            <DialogDescription>{proposal?.summary}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {flow.selected
              ? `将当前 ${flow.graph.nodes.length} 个节点更新为 ${proposal?.graph.nodes.length} 个节点。`
              : `创建 ${proposal?.graph.nodes.length} 个节点的工作流。`}
            应用只更新草稿。
          </p>
          <ol className="max-h-64 list-decimal space-y-2 overflow-auto pl-5 text-sm">
            {proposal?.graph.nodes.map((node) => (
              <li key={node.id}>
                {node.title} · {WORKFLOW_LABELS[node.config.kind]}
                {node.config.kind === "url"
                  ? ` · ${node.config.url}`
                  : node.config.kind === "capture" && node.config.record
                    ? " · 需录制确认"
                    : ""}
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button variant="outline" onClick={() => flow.setProposal(null)}>
              放弃方案
            </Button>
            <Button
              disabled={flow.busy}
              onClick={() => void flow.applyProposal()}
            >
              应用到草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认运行「{flow.graph.title}」</DialogTitle>
            <DialogDescription>
              运行已保存的第 {flow.selected?.revision}{" "}
              版。节点按依赖顺序执行，结果回到当前画布。
            </DialogDescription>
          </DialogHeader>
          <ol className="max-h-64 list-decimal space-y-2 overflow-auto pl-5 text-sm">
            {plan?.steps.map((step) => (
              <li key={step.id}>
                {step.title}
                {step.command.executor === "web.capture"
                  ? ` · ${step.command.url ?? "搜索结果网址"} · ${step.command.record ? "录制前单独确认" : "读取与截图"}`
                  : step.command.executor === "media.trim"
                    ? ` · ${step.command.start}–${step.command.end}秒，导出前单独确认`
                    : ""}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            这些节点不调用付费生成模型。暂停、中断核验与结果记录会持续保留。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(false)}>
              返回编辑
            </Button>
            <Button
              disabled={flow.busy}
              onClick={() => {
                setConfirmRun(false);
                void flow.start(sessionId);
              }}
            >
              确认运行已保存版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
