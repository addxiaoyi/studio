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
  ChevronLeft,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { WORKFLOW_LABELS, creativeWorkflow } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { WorkflowDialogs } from "./dialogs";
import { NodeInspector } from "./node-inspector";
import { WorkflowRunPanel } from "./run-panel";
import { workflowStateLabel } from "./canvas-node";
import { WorkflowLibrary } from "./library-panel";
import { WorkflowResultCompare } from "./compare-results";
import {useFloatingPanel} from "@/hooks/use-floating-panel";
import {
  useWorkflowController,
  workflowConfigs as configs,
  type CanvasWorkflowProps,
} from "./use-workflow-controller";
import "./workflow.css";
import { WorkflowMaterialDropCue } from "./material-drop-cue";
import { WorkflowReferenceEditor } from "./reference-media";
import { WorkflowCanvasLayer } from "./canvas-layer";
import { WorkflowNodePicker } from "./node-picker";
import {WorkflowAssistantChat} from "./assistant-chat";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from "@/components/ui/dialog";
export function WorkflowWorkspace(props: CanvasWorkflowProps) {
  const { token, api, open, onOpen, onClose } = props;
  const floating=useFloatingPanel(open);
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
    selection,references,setReferences,attachReferences,askAi,openLibrary,libraryPrompt,applyPrompt,libraryMode,
    compareOpen,setCompareOpen,reuseResult,bindSelectedMaterial,
    materialDrop,embedMaterials,removeReference,setReferenceFrame,previews,
    pendingSwitch,setPendingSwitch,requestSwitch,confirmSwitch,editNode,deselectNode,disconnect,prepareRun,addingAfter,setAddingAfter,
    prepareAssistant,
  } = useWorkflowController(props);
  const bodyRef=useRef<HTMLDivElement>(null),inspectorRef=useRef<HTMLDivElement>(null);
  const revealInspector=()=>{const body=bodyRef.current,editor=inspectorRef.current;if(body&&editor)body.scrollTop=editor.offsetTop;};
  useEffect(()=>{if(!selected||tab!=="nodes"||!open)return;revealInspector();const body=bodyRef.current;if(!body)return;const resize=new ResizeObserver(revealInspector);resize.observe(body);return()=>resize.disconnect();},[selectedId,tab,open]);
  return (
    <>
      <WorkflowCanvasLayer api={api} token={token} workflowId={flow.selected?.id} graph={flow.graph} disabled={locked} onEdit={editNode} onConnect={connect} onDisconnect={disconnect} onAdd={setAddingAfter} onError={flow.setError}/>
      <WorkflowNodePicker open={addingAfter!==null} onClose={()=>setAddingAfter(null)} onAdd={addNode} disabled={locked} anchor={flow.graph.nodes.find(node=>node.id===addingAfter)?.title}/>
      <WorkflowMaterialDropCue cue={materialDrop.cue} onComplete={materialDrop.clearCue} />
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
        hidden={!floating.present}
        aria-hidden={!open}
        inert={!open}
        ref={floating.ref}
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
              disabled={flow.busy}
              options={[
                { value: "", label: "选择流程" },
                ...flow.documents.map((doc) => ({
                  value: doc.id,
                  label: doc.graph.title,
                })),
              ]}
              onChange={(id) => {
                const doc = flow.documents.find((item) => item.id === id);
                if (doc) requestSwitch(doc);
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
            <button onClick={()=>flow.setError("")} aria-label="关闭提示">知道了</button>
          </div>
        )}
        {flow.recovery && (
          <div className="workflow-banner">
            本机有尚未保存的草稿。
            <button onClick={flow.restoreRecovery} disabled={flow.busy||active}>
              恢复草稿
            </button>
            <button onClick={flow.clearRecovery} disabled={flow.busy}>使用服务器版本</button>
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
          <button aria-pressed={tab === "library"} onClick={()=>openLibrary()}>资源库</button>
        </nav>
        <div className="workflow-dock-body" ref={bodyRef}>
          {tab==="library"&&<WorkflowLibrary initialMode={libraryMode} token={token} canvasId={props.canvasId} graph={flow.selected?flow.graph:null} selectedIds={selection.nodes} prompt={libraryPrompt} disabled={locked} onInsert={graph=>{if(flow.dirty){flow.setError("先保存当前草稿，再插入模板。");return;}void flow.create(false,graph);setSelectedId(null);setTab("nodes");}} onPrompt={applyPrompt}/>}
          {tab==="nodes"&&!selected&&<div className="workflow-template-picker"><StyledSelect aria-label="创作流程模板" value="" disabled={locked||flow.dirty} options={[{value:"",label:"从创作模板开始…"},{value:"script",label:"故事 → 剧本"},{value:"storyboard",label:"剧本 → 分镜"},{value:"film",label:"故事 → 镜头生成 → 成片"}]} onChange={template=>void flow.create(false,creativeWorkflow(template as "script"|"storyboard"|"film"))} /></div>}
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
                            if(flow.selected){editNode(flow.selected.id,node.id);requestAnimationFrame(revealInspector);}
                          }}
                        >
                          <span>
                            <small>{WORKFLOW_LABELS[node.config.kind]}</small>
                            <strong>{node.title}</strong>
                          </span>
                          <span className="workflow-list-state">
                            {workflowStateLabel[states[node.id] ?? "draft"]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {(!selected||materials.length>0)&&<div className="workflow-materials">
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
                  图片、视频可直接拖入生成节点作为参考。也可选中素材后接入，或画箭头连接处理节点。
                </p>
              </div>}
              {selected && (
                <div ref={inspectorRef} className="workflow-selected-editor">
                <div className="workflow-selection-header"><button type="button" onClick={deselectNode}><ChevronLeft size={16}/>全部节点</button><Button size="sm" variant="ghost" onClick={()=>scene.focus(selected.id)}><LocateFixed size={14}/>定位</Button></div>
                {locked&&<p role="status" className="workflow-edit-lock">{flow.recovery?"先处理上方的本机草稿，再继续编辑。":active?"当前版本正在执行，参数已锁定。可在运行记录中暂停或取消。":"正在保存，请稍候。"}</p>}
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
                  onPromptLibrary={()=>openLibrary(true)}
                  materials={materials}
                  onBindMaterial={bindSelectedMaterial}
                  referenceEditor={<WorkflowReferenceEditor graph={flow.graph} node={selected} api={api} token={token} disabled={locked} previews={previews} onEmbed={embedMaterials} onRemove={removeReference} onFrame={setReferenceFrame} />}
                  onDisconnect={disconnect}
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
                /></div>
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
            <WorkflowAssistantChat token={token} canvasId={props.canvasId} workflowId={flow.selected?.id} sessionId={props.sessionId} selectedNodeIds={selection.nodes} referenceIds={references.map(item=>item.id)} prompt={flow.prompt} setPrompt={flow.setPrompt} prepare={prepareAssistant} onApplied={proposal=>{if(proposal.action!=="edit"&&proposal.action!=="inspect")setTab("runs");}}>
              <div className="workflow-ai-references"><Button type="button" size="sm" variant="outline" disabled={locked||!selection.references.length} onClick={attachReferences}>引用画布选区{selection.references.length?`（${selection.references.length}）`:""}</Button><Button type="button" size="sm" variant="ghost" onClick={()=>openLibrary(false,true)} disabled={locked}>提示词库</Button>{references.map((item,index)=><span key={item.id}>@{index+1} {item.title}<button type="button" aria-label={`移除引用${index+1}`} onClick={()=>setReferences(current=>current.filter(reference=>reference.id!==item.id))}>×</button></span>)}</div>
            </WorkflowAssistantChat>
          )}
          {tab === "runs" && (
            <>
              {!!history.length&&flow.selected&&<div className="p-3"><Button variant="outline" size="sm" onClick={()=>setCompareOpen(true)}>对比 / 复用历史结果</Button></div>}
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
            disabled={locked || !plan || !flow.selected || !flow.enabled}
            onClick={() => void prepareRun()}
          >
            <Play size={14} />
            {saving?"正在保存…":flow.dirty&&plan?"保存并运行":"运行流程"}
          </Button>
        </footer>
      </section>
      <Dialog open={Boolean(pendingSwitch)} onOpenChange={value=>{if(!value)setPendingSwitch(null);}}><DialogContent><DialogHeader><DialogTitle>切换前保留当前修改</DialogTitle><DialogDescription>当前流程有未保存修改。可以保存到工作区，也可以保留为本机草稿后切换；不会运行任何节点。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={()=>setPendingSwitch(null)}>继续编辑</Button><Button variant="outline" disabled={saving||flow.busy} onClick={()=>void confirmSwitch(false)}>保留本机草稿并切换</Button><Button disabled={saving||flow.busy} onClick={()=>void confirmSwitch(true)}>保存并切换</Button></DialogFooter></DialogContent></Dialog>
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
      {flow.selected&&<WorkflowResultCompare open={compareOpen} onClose={()=>setCompareOpen(false)} token={token} canvasId={props.canvasId} workflowId={flow.selected.id} history={history} disabled={locked} onReuse={reuseResult}/>}
    </>
  );
}
