"use client";
import { workflowOutlets } from "@helstera/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WORKFLOW_LABELS,
  compileWorkflow,
  connectionIssue,
  layoutWorkflow,
  workflowRunGraph,
  insertWorkflowNode,
  validateWorkflow,
  type WorkflowNode,
  type AgentGoal,
  type WorkflowDocument,
} from "@helstera/shared";
import { useAuth } from "@/lib/auth-context";
import { fetchWorkflowRuns } from "@/lib/canvas-workflow-api";
import { useCanvasWorkflow } from "./use-workflow";
import { useWorkflowRun } from "./run-panel";
import {
  materialNode,
  nodeElementId,
  workflowWithScenePositions,
  linkWorkflowResults,
  type WorkflowCanvasApi,
  type NodePreview,
} from "./scene";
import { useCanvasWorkflowScene } from "./use-canvas-scene";
import { workflowStepState } from "./step-state";
import { useSceneContext, type CanvasReference } from "./use-scene-context";
import { useWorkflowMaterialDrop } from "./use-material-drop";
import { embedWorkflowMaterials, removeWorkflowReference } from "./material-inputs";
import { nextNodePosition } from "./graph-state";
export type CanvasWorkflowProps = {
  token: string;
  canvasId: string;
  sessionId?: string | undefined;
  initialId?: string | undefined;
  api: WorkflowCanvasApi | null;
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onCanvasSync(): void | Promise<void>;
  saveCanvas(): Promise<void>;
};
export const workflowConfigs = {
  text: {kind:"text",role:"story",text:""},
  write: {kind:"write",mode:"storyboard",instruction:"",shotCount:3},
  shot: {kind:"shot",index:1},
  generate: {kind:"generate",mediaType:"image",model:"",prompt:"",aspectRatio:"16:9",duration:5,resolution:"720p"},
  compose: {kind:"compose",aspect:"landscape"},
  frame: {kind:"frame",at:0},
  condition:{kind:"condition",conditions:[{field:"text",operator:"not_empty",value:""}],match:"all"},
  switch:{kind:"switch",mode:"first",cases:[{id:"route-1",title:"分支 1",conditions:[{field:"text",operator:"contains",value:""}],match:"all"}]},
  split:{kind:"split",source:"json",path:"",separator:"\n",maxItems:50},
  batch:{kind:"batch",maxItems:50,batchSize:5,operations:[{kind:"template",template:"{{index}}. {{text}}"}]},
  transform:{kind:"transform",operation:"trim",search:"",replacement:""},
  template:{kind:"template",template:"{{text}}"},merge:{kind:"merge",separator:"\n\n"},
  json:{kind:"json",json:'{"message":"你好"}'},extract:{kind:"extract",path:"message"},delay:{kind:"delay",seconds:3},
  url: { kind: "url", url: "" },
  search: { kind: "search", query: "" },
  capture: { kind: "capture", record: false, pageLimit: 1 },
  trim: { kind: "trim", start: 0, end: 5, aspect: "original" },
  deliver: { kind: "deliver" },
} satisfies Record<string, WorkflowNode["config"]>;
export function useWorkflowController({
  token,
  canvasId,
  sessionId,
  initialId,
  api,
  open,
  onOpen,
  onCanvasSync,
  saveCanvas,
}: CanvasWorkflowProps) {
  const { session } = useAuth();
  const flow = useCanvasWorkflow(
    token,
    canvasId,
    session?.user.id ?? "",
    initialId,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"nodes" | "ai" | "runs" | "library">("nodes");
  const [compareOpen,setCompareOpen]=useState(false),[references,setReferences]=useState<CanvasReference[]>([]);
  const [libraryTarget,setLibraryTarget]=useState<string|null>(null);
  const [libraryMode,setLibraryMode]=useState<"workflow"|"prompt">("workflow");
  const [confirmRun, setConfirmRun] = useState(false),
    [saving, setSaving] = useState(false);
  const [pendingSwitch,setPendingSwitch]=useState<WorkflowDocument|null>(null);
  const [addingAfter,setAddingAfter]=useState<string|null>(null);
  const [insertingEdge,setInsertingEdge]=useState<string|null>(null);
  const [runTarget,setRunTarget]=useState<string|null>(null);
  const [materials, setMaterials] = useState<WorkflowNode[]>([]);
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof fetchWorkflowRuns>>
  >([]);
  const completedScope = useRef({
    api,
    graph: flow.graph,
    workflowId: flow.selected?.id,
    onCanvasSync,
    runs:history,
  });
  completedScope.current = {
    api,
    graph: flow.graph,
    workflowId: flow.selected?.id,
    onCanvasSync,
    runs:history,
  };
  const completed = useCallback(async (goal: AgentGoal) => {
    const scope = completedScope.current;
    await scope.onCanvasSync();
    if (
      scope.api &&
      scope.workflowId &&
      Array.isArray(goal.result?.canvasElementIds)
    ) {
      const ids = goal.result.canvasElementIds.filter(
        (id): id is string => typeof id === "string",
      );
      scope.api.updateScene({
        elements: linkWorkflowResults(
          scope.api.getSceneElementsIncludingDeleted(),
          scope.workflowId,
          scope.graph,
          goal.id,
          ids,
          scope.runs.find(item=>item.goalId===goal.id)?.targetNodeId??undefined,
        ),
        captureUpdate: "NEVER",
      });
    }
  }, []);
  const run = useWorkflowRun(token, flow.goalId, completed);
  const active = Boolean(
    run.goal && !["completed", "failed", "canceled"].includes(run.goal.status),
  );
  const locked = flow.busy || active || saving || Boolean(flow.recovery);
  const viewedRun=history.find((item)=>item.goalId===flow.goalId);
  const currentRun =
    !flow.dirty &&
    viewedRun?.revision ===
      flow.selected?.revision;
  const states = useMemo(
    () =>
      Object.fromEntries(
        flow.graph.nodes.map((node) => [
          node.id,
          currentRun && viewedRun?.graph.nodes.some(item=>item.id===node.id)
            ? node.config.kind === "url" ? "succeeded" : workflowStepState(run.goal?.executionSteps?.find(step=>step.stepId===node.id))
            : "draft",
        ]),
      ),
    [flow.graph, run.goal, currentRun, viewedRun],
  );
  const issues = useMemo(() => validateWorkflow(flow.graph), [flow.graph]);
  const selected = flow.graph.nodes.find((node) => node.id === selectedId);
  const selection=useSceneContext(api,flow.selected?.id);
  const target=flow.graph.nodes.find(node=>node.id===libraryTarget);
  const libraryPrompt=target?.config.kind==="generate"?target.config.prompt:target?.config.kind==="write"?target.config.instruction:target?.config.kind==="text"?target.config.text:flow.prompt;
  const openLibrary=(forNode=false,prompts=false)=>{setLibraryTarget(forNode?selectedId:null);setLibraryMode(forNode||prompts?"prompt":"workflow");setTab("library");};
  const applyPrompt=(prompt:string,append:boolean)=>{
    const text=append?[libraryPrompt,prompt].filter(Boolean).join("\n\n"):prompt;
    if(text.length>4000){flow.setError("合并后的提示词超过4000字，请缩短后再使用。");return;}
    if(target){
      const config=target.config;
      if(config.kind==="write"&&text.length>2000){flow.setError("编剧要求最多2000字，请缩短后再使用。");return;}
      const next=config.kind==="generate"?{...config,prompt:text}:config.kind==="write"?{...config,instruction:text}:config.kind==="text"?{...config,text}:null;
      if(!next){flow.setError("请选择文字、编剧或生成节点。");return;}
      flow.edit({...flow.graph,nodes:flow.graph.nodes.map(node=>node.id===target.id?{...node,config:next}:node)});setTab("nodes");
    }else{flow.setPrompt(text);setTab("ai");}
  };
  const attachReferences=()=>{setReferences(current=>[...current,...selection.references.filter(item=>!current.some(reference=>reference.id===item.id))].slice(0,12));};
  const askAi=async()=>{try{await saveCanvas();await flow.askAi(references.map(item=>item.id));}catch(cause){flow.setError(cause instanceof Error?cause.message:"画布保存失败，未发送引用。");}};
  const reuseResult=async(node:WorkflowNode)=>{
    if(!flow.selected||locked)throw new Error("先结束当前运行再复用结果。");
    if(flow.graph.nodes.length>=64)throw new Error("当前流程已达64个节点上限。");
    await onCanvasSync();
    const anchor=selected??flow.graph.nodes.at(-1);
    const next=node.config.kind==="asset"?node:{...node,position:{x:(anchor?.position.x??0)+390,y:anchor?.position.y??0}};
    const elementId=next.config.kind==="asset"?next.config.elementId:null;
    if(elementId&&flow.graph.nodes.some(item=>item.config.kind==="asset"&&item.config.elementId===elementId))throw new Error("该素材已经是当前流程输入。");
    flow.edit({...flow.graph,nodes:[...flow.graph.nodes,next]});setSelectedId(next.id);setCompareOpen(false);setTab("nodes");
  };
  const bindSelectedMaterial=()=>{
    if(!selected||selected.config.kind!=="asset"||locked)return;
    const desiredType=selected.config.mediaType;
    const source=materials.find(node=>node.config.kind==="asset"&&node.config.mediaType===desiredType);
    if(!source){flow.setError(`在画布中选择一项已保存的${desiredType==="image"?"图片":"视频"}。`);return;}
    if(flow.graph.nodes.some(node=>node.id!==selected.id&&node.config.kind==="asset"&&source.config.kind==="asset"&&node.config.elementId===source.config.elementId)){flow.setError("该素材已绑定到当前流程的另一个节点。");return;}
    flow.edit({...flow.graph,nodes:flow.graph.nodes.map(node=>node.id===selected.id?{...node,position:source.position,config:source.config}:node)});
  };
  const selectNode = (workflowId: string, nodeId: string, openEditor=false) => {
    if(!openEditor){if(workflowId!==flow.selected?.id||nodeId!==selectedId)setSelectedId(null);return false;}
    if (workflowId !== flow.selected?.id) {
      if(!openEditor)return false;
      if (flow.dirty) {
        setPendingSwitch(flow.documents.find(item=>item.id===workflowId)??null);
        return false;
      }
      const document = flow.documents.find((item) => item.id === workflowId);
      if (!document) return false;
      flow.select(document,api?workflowWithScenePositions(document.graph,document.id,api.getSceneElements()):undefined);
    }
    setSelectedId(nodeId);
    if(openEditor){setTab("nodes");if(!open)onOpen();}
    return true;
  };
  const previews = useMemo<Record<string,NodePreview>>(()=>Object.fromEntries((currentRun ? run.goal?.executionSteps ?? [] : []).map(step=>{
    const assets = step.output?.assets as Array<{id?:unknown;mediaType?:unknown}> | undefined;
    const asset = assets?.find(item=>typeof item.id==="string" && ["image","video"].includes(String(item.mediaType)));
    return [step.stepId,{...(typeof step.output?.text==="string"?{text:step.output.text.slice(0,300)}:{}),...(asset?{assetId:String(asset.id),mediaType:asset.mediaType as "image"|"video"}:{})}];
  })),[run.goal,currentRun]);
  const materialDrop = useWorkflowMaterialDrop({ api, workflowId: flow.selected?.id, graph: flow.graph, locked, edit: flow.edit, select: id => { setSelectedId(id); setTab("nodes"); }, error: flow.setError });
  const embedMaterials = (elementIds: string[]) => {
    if (!api || !selected || locked) return;
    try {
      const elements = elementIds.map(id => api.getSceneElements().find(el => el.id === id));
      if (elements.some(el => !el)) throw new Error("素材已删除，请重新选择。");
      flow.edit(embedWorkflowMaterials(flow.graph, elements.filter(el => !!el), selected.id));
      flow.setError("");
    } catch (cause) { flow.setError(cause instanceof Error ? cause.message : "无法嵌入素材。"); }
  };
  const removeReference = (sourceId: string) => { if (selected && !locked) flow.edit(removeWorkflowReference(flow.graph, selected.id, sourceId)); };
  const setReferenceFrame = (sourceId: string, at: number) => { if (!locked) flow.edit({ ...flow.graph, nodes: flow.graph.nodes.map(node => node.id === sourceId && node.config.kind === "frame" ? { ...node, config: { ...node.config, at } } : node) }); };
  const scene = useCanvasWorkflowScene({
    api,
    document: flow.selected,
    graph: flow.graph,
    states,
    previews,
    locked,
    open,
    executionLocked:active,
    edit: flow.edit,
    select: selectNode,
    error: flow.setError,
    suspendSync: materialDrop.dragging,
    recoveryPending:Boolean(flow.recovery),
    deselect:()=>setSelectedId(null),
  });
  const materialSignature = useRef("");
  useEffect(() => {
    if (!api) return;
    const inspect = () => {
      const selected = api.getAppState().selectedElementIds;
      const media = api
        .getSceneElements()
        .filter((el) => selected[el.id])
        .map(materialNode)
        .filter((node): node is WorkflowNode => Boolean(node));
      const signature = JSON.stringify(media);
      if (signature !== materialSignature.current) {
        materialSignature.current = signature;
        setMaterials(media);
      }
    };
    inspect();
    return api.onChange(inspect);
  }, [api]);
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
      .catch((cause) => {
        if (alive) flow.setError(cause.message);
      });
    return () => {
      alive = false;
    };
  }, [token, canvasId, flow.selected?.id, flow.goalId, run.goal?.status]);
  const refreshRun = useCallback(() => run.refresh(), [run.refresh]);
  const save = async () => {
    if (saving) return null;
    setSaving(true);
    try {
      await saveCanvas();
      return await flow.save();
    } catch (cause) {
      flow.setError(
        cause instanceof Error ? cause.message : "画布保存失败，请重试。",
      );
      return null;
    } finally {
      setSaving(false);
    }
  };
  const connect = (source: string, target: string, branch?:string) => {
    if(locked)return;
    const outputBranch=branch??(workflowOutlets(flow.graph.nodes.find(node=>node.id===source))[0]?.value);
    const issue = connectionIssue(flow.graph, source, target,outputBranch);
    if (issue) {
      flow.setError(issue);
      return;
    }
    flow.edit({
      ...flow.graph,
      edges: [
        ...flow.graph.edges,
        { id: `edge-${crypto.randomUUID()}`, source, target,...(outputBranch?{branch:outputBranch}:{}) },
      ],
    });
    flow.setError("");
  };
  const requestSwitch=(doc:WorkflowDocument)=>{if(flow.dirty){setPendingSwitch(doc);return;}flow.select(doc);setSelectedId(null);};
  const confirmSwitch=async(persist:boolean)=>{if(!pendingSwitch)return;if(persist&&!(await save()))return;flow.select(pendingSwitch,api?workflowWithScenePositions(pendingSwitch.graph,pendingSwitch.id,api.getSceneElements()):undefined);setSelectedId(null);setPendingSwitch(null);};
  const editNode=(workflowId:string,nodeId:string)=>{
    if(!selectNode(workflowId,nodeId,true))return false;
    if(!locked&&workflowId===flow.selected?.id&&flow.graph.groups?.some(group=>group.collapsed&&group.nodeIds.includes(nodeId)))flow.edit({...flow.graph,groups:flow.graph.groups.map(group=>group.nodeIds.includes(nodeId)?{...group,collapsed:false}:group)});
    const doc=flow.documents.find(item=>item.id===workflowId),node=doc?.id===flow.selected?.id?flow.graph.nodes.find(item=>item.id===nodeId):doc?.graph.nodes.find(item=>item.id===nodeId);
    if(node)api?.updateScene({appState:{selectedElementIds:{[nodeElementId(workflowId,node)]:true}},captureUpdate:"NEVER"});
    setSelectedId(nodeId);
    return true;
  };
  const askNode=(workflowId:string,nodeId:string)=>{
    if(!editNode(workflowId,nodeId))return;
    setTab("ai");
    requestAnimationFrame(()=>document.getElementById("workflow-ai-request")?.focus());
  };
  const deselectNode=()=>{setSelectedId(null);api?.updateScene({appState:{selectedElementIds:{}},captureUpdate:"NEVER"});};
  const disconnect=(edgeId:string)=>{if(locked)return;flow.edit({...flow.graph,edges:flow.graph.edges.filter(edge=>edge.id!==edgeId)});const picked=api?.getSceneElements().some(el=>api.getAppState().selectedElementIds[el.id]&&(el.customData?.workflowEdge as {edgeId?:string}|undefined)?.edgeId===edgeId);if(picked)api?.updateScene({appState:{selectedElementIds:{}},captureUpdate:"NEVER"});flow.setError("");};
  const addNode = (kind: string) => {
    if (!flow.selected || locked || !(kind in workflowConfigs)) return;
    const config = workflowConfigs[kind as keyof typeof workflowConfigs];
    const wire=flow.graph.edges.find(edge=>edge.id===insertingEdge);
    const anchor = flow.graph.nodes.find(node=>node.id===(wire?.source??addingAfter)) ?? selected ?? flow.graph.nodes.at(-1);
    const occupied=api?.getSceneElements().filter(el=>!el.isDeleted)??flow.graph.nodes.map(node=>({...node.position,width:300,height:node.config.kind==="generate"?280:184}));
    const node: WorkflowNode = {
      id: `node-${crypto.randomUUID()}`,
      title: WORKFLOW_LABELS[config.kind],
      config: structuredClone(config),
      position: nextNodePosition(anchor?.position??{x:0,y:0},occupied,config.kind==="generate"?280:184),
    };
    if(insertingEdge){
      try{flow.edit(insertWorkflowNode(flow.graph,insertingEdge,node,`edge-${crypto.randomUUID()}`));setSelectedId(node.id);setTab("nodes");setInsertingEdge(null);onOpen();requestAnimationFrame(()=>scene.focus(node.id));}
      catch(cause){flow.setError(cause instanceof Error?cause.message:"插入节点失败。");}
      return;
    }
    const graph = { ...flow.graph, nodes: [...flow.graph.nodes, node] };
    const branch=workflowOutlets(anchor)[0]?.value;
    if (anchor && !connectionIssue(graph, anchor.id, node.id,branch))
      graph.edges = [
        ...graph.edges,
        {
          id: `edge-${crypto.randomUUID()}`,
          source: anchor.id,
          target: node.id,
          ...(branch?{branch}:{}),
        },
      ];
    flow.edit(graph);
    setSelectedId(node.id);
    setTab("nodes");
    setAddingAfter(null);
    if(!open)onOpen();
    requestAnimationFrame(()=>scene.focus(node.id));
  };
  const importMaterials = () => {
    if (!materials.length || locked) return;
    if (!flow.selected) {
      const first = materials[0]!;
      const output: WorkflowNode = {
        id: "deliver",
        title: "保存素材与结果",
        position: { x: first.position.x + 390, y: first.position.y },
        config: { kind: "deliver" },
      };
      void flow.create(false, {
        title: "画布素材流程",
        nodes: [...materials, output],
        edges: materials.map((node, i) => ({
          id: `input-${i}`,
          source: node.id,
          target: output.id,
        })),
      });
      return;
    }
    const fresh = materials.filter(
      (node) => !flow.graph.nodes.some((existing) => existing.id === node.id),
    );
    if (!fresh.length) {
      flow.setError("所选素材已经在当前流程中。");
      return;
    }
    if (flow.graph.nodes.length + fresh.length > 64) {
      flow.setError("单个流程最多64个节点，请减少所选素材。");
      return;
    }
    flow.edit({ ...flow.graph, nodes: [...flow.graph.nodes, ...fresh] });
    setSelectedId(fresh[0]!.id);
    setTab("nodes");
  };
  const arrange = () => {
    try {
      const positioned = layoutWorkflow(flow.graph),
        anchor = flow.graph.nodes[0]?.position ?? { x: 0, y: 0 };
      flow.edit({
        ...positioned,
        nodes: positioned.nodes.map((node) => ({
          ...node,
          position: {
            x: Math.min(990800, node.position.x + anchor.x),
            y: Math.min(990800, node.position.y + anchor.y),
          },
        })),
      });
      setTimeout(() => scene.focus(), 0);
    } catch (cause) {
      flow.setError(cause instanceof Error ? cause.message : "节点连线有误。");
    }
  };
  const locateResult = () => {
    const ids = run.goal?.result?.canvasElementIds;
    if (Array.isArray(ids))
      scene.locateResults(
        ids.filter((id): id is string => typeof id === "string"),
      );
  };
  let plan: ReturnType<typeof compileWorkflow> | null = null;
  try {
    plan = compileWorkflow(flow.graph);
  } catch {
    /* Node issues remain visible before execution. */
  }
  async function startRun() {
    setConfirmRun(false);
    try {
      await saveCanvas();
      if(await flow.start(sessionId,runTarget??undefined))setTab("runs");
    } catch (cause) {
      flow.setError(cause instanceof Error ? cause.message : "画布保存失败。");
    }
  }
  async function prepareRun(targetId?:string){
    if(locked)return;
    try {compileWorkflow(workflowRunGraph(flow.graph,targetId));}catch(cause){flow.setError(cause instanceof Error?cause.message:"节点参数未完善。");return;}
    if(flow.dirty&&!(await save()))return;
    setRunTarget(targetId??null);setConfirmRun(true);
  }
  let confirmationPlan:ReturnType<typeof compileWorkflow>|null=null;
  try{confirmationPlan=compileWorkflow(workflowRunGraph(flow.graph,runTarget??undefined));}catch{/* Keep the draft editable until required inputs are present. */}
  const saveRef=useRef(save);saveRef.current=save;
  const assistantScope=useRef({flow,onOpen});assistantScope.current={flow,onOpen};
  useEffect(()=>{const changed=(event:Event)=>{const detail=(event as CustomEvent<{id?:string}>).detail;if(!detail?.id)return;void assistantScope.current.flow.refresh(detail.id);assistantScope.current.onOpen();};window.addEventListener("loomic:workflow-changed",changed);return()=>window.removeEventListener("loomic:workflow-changed",changed);},[]);
  const prepareAssistant=async()=>{try{await saveCanvas();if(flow.recovery)throw new Error("请先处理恢复草稿。");if(flow.dirty)return Boolean(await flow.save());return true;}catch(cause){flow.setError(cause instanceof Error?cause.message:"画布保存失败。");return false;}};
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(open&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();if(!locked)void saveRef.current();}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[open,locked]);
  const proposal = flow.proposal;
  return {
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
    prepareAssistant,askNode,insertingEdge,setInsertingEdge,runTarget,confirmationPlan,viewedRun,
  };
}
