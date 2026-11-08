"use client";
import {
  GitBranch,
  LayoutGrid,
  LocateFixed,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  X,
  ArrowUpRight,
  ImagePlus,
} from "lucide-react";
import { WORKFLOW_LABELS, creativeWorkflow } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { WorkflowDialogs } from "./dialogs";
import { NodeInspector } from "./node-inspector";
import { WorkflowRunPanel } from "./run-panel";
import { workflowStateLabel } from "./canvas-node";
import {
  useWorkflowController,
  workflowConfigs as configs,
  type CanvasWorkflowProps,
} from "./use-workflow-controller";
import "./workflow.css";
export function WorkflowWorkspace(props: CanvasWorkflowProps) {
  const { token, api, open, onOpen, onClose } = props;
  const {
    flow,
    run,
    active,
    states,
    issues,
    selectedId,
    setSelectedId,
    tab,
    setTab,
    confirmRun,
    setConfirmRun,
    saving,
    materials,
    history,
    locked,
    selected,
    scene,
    save,
    connect,
    addNode,
    importMaterials,
    arrange,
    locateResult,
    plan,
    proposal,
    startRun,
    refreshRun,
  } = useWorkflowController(props);
  return (
    <>
      {!open && flow.selected && (
        <button
          className="canvas-workflow-launch"
          onClick={onOpen}
          aria-label="展开画布流程"
        >
          <GitBranch size={16} />
          <span>{flow.graph.title}</span>
          <small>{flow.dirty ? "未保存" : active ? "执行中" : "流程"}</small>
        </button>
      )}
      <section
        className="workflow-dock"
        aria-label="可视化工作流"
        hidden={!open}
      >
        <header className="workflow-header">
          <div>
            <h2>
              <GitBranch size={18} />
              画布流程
            </h2>
            <p>素材与节点，同一张画布</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="收起流程面板"
          >
            <X size={17} />
          </Button>
        </header>
        <div className="workflow-toolbar">
          <div className="min-w-0 flex-1">
            <StyledSelect
              aria-label="选择工作流"
              value={flow.selected?.id ?? ""}
              disabled={flow.busy || flow.dirty}
              options={[
                { value: "", label: "选择流程" },
                ...flow.documents.map((doc) => ({
                  value: doc.id,
                  label: doc.graph.title,
                })),
              ]}
              onChange={(id) => {
                const doc = flow.documents.find((item) => item.id === id);
                if (doc) flow.select(doc);
              }}
            />
          </div>
          <Button
            size="icon"
            variant="outline"
            disabled={flow.busy || flow.dirty}
            onClick={() => void flow.create()}
            aria-label="新建流程"
          >
            <Plus size={16} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={locked || !flow.dirty}
            onClick={() => void save()}
            aria-label={flow.dirty ? "保存草稿" : "已保存"}
          >
            <Save size={16} />
          </Button>
        </div>
        {(flow.error || run.error) && (
          <div role="alert" className="workflow-banner is-error">
            {flow.error || run.error}
            <button onClick={() => void flow.refresh()} disabled={locked}>
              重新加载
            </button>
          </div>
        )}
        {flow.recovery && (
          <div className="workflow-banner">
            本机有尚未保存的草稿。
            <button onClick={flow.restoreRecovery} disabled={locked}>
              恢复草稿
            </button>
            <button onClick={flow.clearRecovery}>使用服务器版本</button>
          </div>
        )}
        {flow.loading && (
          <p role="status" className="workflow-banner">
            正在读取画布流程…
          </p>
        )}
        {flow.selected && (
          <div className="workflow-project-bar">
            <input
              aria-label="流程名称"
              value={flow.graph.title}
              disabled={locked}
              maxLength={120}
              onChange={(event) =>
                flow.edit({
                  ...flow.graph,
                  title: event.target.value || "未命名流程",
                })
              }
            />
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                disabled={locked || !flow.undo.length}
                onClick={flow.undoEdit}
                aria-label="撤销工作流修改"
              >
                <Undo2 size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={locked || !flow.redo.length}
                onClick={flow.redoEdit}
                aria-label="重做工作流修改"
              >
                <Redo2 size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={locked}
                onClick={arrange}
                aria-label="自动排列"
              >
                <LayoutGrid size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => scene.focus()}
                aria-label="定位流程节点"
              >
                <LocateFixed size={14} />
              </Button>
            </div>
          </div>
        )}
        <nav className="workflow-tabs" aria-label="流程面板">
          <button
            aria-pressed={tab === "nodes"}
            onClick={() => setTab("nodes")}
          >
            节点{flow.selected ? ` · ${flow.graph.nodes.length}` : ""}
          </button>
          <button aria-pressed={tab === "ai"} onClick={() => setTab("ai")}>
            <Sparkles size={14} />
            AI 搭建
          </button>
          <button aria-pressed={tab === "runs"} onClick={() => setTab("runs")}>
            运行记录
          </button>
        </nav>
        <div className="workflow-dock-body">
          <div className="workflow-template-picker"><StyledSelect aria-label="创作流程模板" value="" disabled={locked||flow.dirty} options={[{value:"",label:"从创作模板开始…"},{value:"script",label:"故事 → 剧本"},{value:"storyboard",label:"剧本 → 分镜"},{value:"film",label:"故事 → 镜头生成 → 成片"}]} onChange={template=>void flow.create(false,creativeWorkflow(template as "script"|"storyboard"|"film"))} /></div>
          {tab === "nodes" && (
            <>
              {!flow.selected ? (
                <div className="workflow-empty">
                  <h3>连接创作的每一步</h3>
                  <p>
                    节点直接放在当前画布中，图片、视频、文字和手绘内容可以放在一起。
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void flow.create()}
                    disabled={flow.busy}
                  >
                    网站研究与截图
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void flow.create(true)}
                    disabled={flow.busy}
                  >
                    网站录制流程
                  </Button>
                </div>
              ) : (
                <>
                  <div className="workflow-palette">
                    <StyledSelect
                      aria-label="添加节点"
                      value=""
                      disabled={locked || flow.graph.nodes.length >= 24}
                      options={[
                        { value: "", label: "＋ 添加处理节点" },
                        ...Object.keys(configs).map((kind) => ({
                          value: kind,
                          label: WORKFLOW_LABELS[kind as keyof typeof configs],
                        })),
                      ]}
                      onChange={addNode}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => api?.setActiveTool({ type: "arrow" })}
                    >
                      画连线 A
                    </Button>
                  </div>
                  <ol className="workflow-node-list" aria-label="画布流程节点">
                    {flow.graph.nodes.map((node) => (
                      <li key={node.id}>
                        <button
                          aria-pressed={selectedId === node.id}
                          onClick={() => {
                            setSelectedId(node.id);
                            scene.focus(node.id);
                          }}
                        >
                          <span>
                            <small>{WORKFLOW_LABELS[node.config.kind]}</small>
                            <strong>{node.title}</strong>
                          </span>
                          <span className="workflow-list-state">
                            {workflowStateLabel[states[node.id] ?? "draft"]}
                            <ArrowUpRight size={13} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <div className="workflow-materials">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={importMaterials}
                  disabled={locked || !materials.length}
                >
                  <ImagePlus size={15} />
                  使用所选素材
                  {materials.length ? `（${materials.length}）` : ""}
                </Button>
                <p>
                  在画布选中已上传的图片或视频，再接入流程。也可画箭头把视频连到裁剪节点。
                </p>
              </div>
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
                  onReorder={(id,direction)=>{
                    const edges=[...flow.graph.edges],index=edges.findIndex(edge=>edge.id===id);
                    const siblings=edges.map((edge,position)=>({edge,position})).filter(item=>item.edge.target===selected.id);
                    const position=siblings.findIndex(item=>item.position===index),neighbor=siblings[position+direction]?.position;
                    if(neighbor===undefined)return;
                    [edges[index],edges[neighbor]]=[edges[neighbor]!,edges[index]!];flow.edit({...flow.graph,edges});
                  }}
                  onDelete={(id) => {
                    flow.edit({
                      ...flow.graph,
                      nodes: flow.graph.nodes.filter((node) => node.id !== id),
                      edges: flow.graph.edges.filter(
                        (edge) => edge.source !== id && edge.target !== id,
                      ),
                    });
                    setSelectedId(null);
                  }}
                />
              )}
              {!!issues.length && flow.selected && (
                <div className="workflow-validation">
                  <h3>运行前完善 {issues.length} 项</h3>
                  {issues.map((issue, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (issue.nodeId) {
                          setSelectedId(issue.nodeId);
                          scene.focus(issue.nodeId);
                        }
                      }}
                    >
                      {issue.message}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "ai" && (
            <form
              className="workflow-ai"
              onSubmit={(event) => {
                event.preventDefault();
                void flow.askAi();
              }}
            >
              <label htmlFor="workflow-ai-request">让 AI 帮你搭建</label>
              <textarea
                id="workflow-ai-request"
                rows={6}
                value={flow.prompt}
                onChange={(event) => flow.setPrompt(event.target.value)}
                disabled={locked}
                placeholder="例如：录制这个网站，截取前 5 秒，把成片放回画布。"
              />
              <p>
                AI
                读取当前节点与素材关系，先给你方案，确认后才应用到画布；运行另行确认。
              </p>
              <Button type="submit" disabled={locked || !flow.prompt.trim()}>
                <Sparkles size={15} />
                {flow.busy ? "生成中…" : "生成方案"}
              </Button>
            </form>
          )}
          {tab === "runs" && (
            <>
              {!!history.length && (
                <div className="p-3">
                  <StyledSelect
                    aria-label="查看运行历史"
                    value={flow.goalId ?? ""}
                    options={history.map((item) => ({
                      value: item.goalId,
                      label: `第${item.revision}版 · ${new Date(item.createdAt).toLocaleString()}`,
                    }))}
                    onChange={flow.setGoalId}
                  />
                </div>
              )}
              {run.goal ? (
                <>
                  <WorkflowRunPanel
                    token={token}
                    goal={run.goal}
                    onRefresh={refreshRun}
                  />
                  {run.goal.status === "completed" && (
                    <Button
                      className="m-3"
                      variant="outline"
                      onClick={locateResult}
                    >
                      <LocateFixed size={15} />
                      定位画布结果
                    </Button>
                  )}
                </>
              ) : (
                <div className="workflow-empty">
                  <h3>还没有运行记录</h3>
                  <p>保存并确认流程后，这里会显示每一步的进度、审批与结果。</p>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="workflow-dock-footer">
          <span role="status">
            {saving
              ? "正在保存…"
              : flow.dirty
                ? "草稿未保存"
                : active
                  ? "流程正在执行"
                  : run.goal?.status === "completed"
                    ? "最近运行已完成"
                    : flow.notice || "节点与普通素材可共同编辑"}
          </span>
          <Button
            size="sm"
            disabled={
              locked || flow.dirty || !plan || !flow.selected || !flow.enabled
            }
            onClick={() => setConfirmRun(true)}
          >
            <Play size={14} />
            运行流程
          </Button>
        </footer>
      </section>
      <WorkflowDialogs
        proposal={proposal}
        title={flow.graph.title}
        revision={flow.selected?.revision}
        plan={plan}
        confirmRun={confirmRun}
        busy={locked}
        discard={() => flow.setProposal(null)}
        apply={() => {
          void flow.applyProposal();
          setTab("nodes");
        }}
        setConfirmRun={setConfirmRun}
        run={() => void startRun()}
      />
    </>
  );
}
