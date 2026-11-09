"use client";
import {
  ArrowRight,
  Film,
  Globe,
  ImageIcon,
  PackageCheck,
  Scissors,
  Search,
  FileText, Sparkles, Clapperboard, Wand2, Layers, Camera,GitFork,Braces,Filter,CaseSensitive,Clock,Pin,
} from "lucide-react";
import { WORKFLOW_LABELS } from "@helstera/shared";
import { workflowBinding, type SceneElement } from "./scene";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";
import {MarkdownRenderer} from "@/components/chat/markdown-renderer";
import "./workflow.css";
import { WorkflowReferenceThumb } from "./reference-media";

export const workflowStateLabel: Record<string, string> = {
  skipped:"已跳过",pinned:"复用固定结果",waiting:"等待中",
  draft: "草稿",
  queued: "待执行",
  running: "执行中",
  succeeded: "已完成",
  waiting_approval: "等待确认",
  failed: "执行失败",
  canceled: "已取消",
  review: "待核验",
  waiting_desktop: "等待执行器",
};
const icons = {
  switch:GitFork,split:Filter,batch:Layers,
  condition:GitFork,json:Braces,extract:Filter,transform:CaseSensitive,template:FileText,merge:Layers,delay:Clock,
  text:FileText,write:Sparkles,shot:Clapperboard,generate:Wand2,compose:Layers,frame:Camera,
  url: Globe,
  search: Search,
  capture: Film,
  trim: Scissors,
  deliver: PackageCheck,
  asset: ImageIcon,
};
export function WorkflowCanvasNode({ element, accessToken, selected = false, connecting = false, issue, outputs }: { element: SceneElement; accessToken: string; selected?:boolean; connecting?:boolean; issue?:string|undefined; outputs?:number|undefined }) {
  const binding = workflowBinding(element);
  if (!binding) return null;
  const { node, state } = binding,
    config = node.config,
    Icon = icons[config.kind];
  const detail =
    config.kind==="switch"?`${config.cases.length} 个出口 + 默认 · ${config.mode==="first"?"首次命中":"所有命中"}`
    :config.kind==="split"?`${config.source==="json"?"JSON 列表":"拆分文字"} · 最多 ${config.maxItems} 项`
    :config.kind==="batch"?`${config.operations.length} 个逐项动作 · 每批 ${config.batchSize} 项 / 上限 ${config.maxItems}`
    :
    config.kind==="condition"?`${config.conditions.length} 项条件 · ${config.match==="all"?"全部满足":"任一满足"}`
    :config.kind==="json"?config.json
    :config.kind==="extract"?`提取 ${config.path}`
    :config.kind==="template"?config.template
    :config.kind==="transform"?({trim:"移除首尾空白",uppercase:"转换为大写",lowercase:"转换为小写",replace:"替换指定文字"}[config.operation])
    :config.kind==="merge"?"合并已命中的文字分支"
    :config.kind==="delay"?`等待 ${config.seconds} 秒`
    :
    config.kind === "text" ? config.text || "填写故事、剧本或角色设定"
    : config.kind === "write" ? `${config.mode === "storyboard" ? `拆分${config.shotCount}个镜头` : config.mode === "script" ? "创作剧本" : "改写内容"} · 本站 Agent`
    : config.kind === "shot" ? `提取上游第 ${config.index} 个镜头`
    : config.kind === "generate" ? `${config.mediaType === "image" ? "图片" : "视频"} · ${config.model || "待选择模型"} · 逐次费用确认`
    : config.kind === "compose" ? "按输入顺序拼接镜头与音轨"
    : config.kind === "frame" ? `提取第 ${config.at} 秒画面`
    : config.kind === "url"
      ? config.url || "设置目标网址"
      : config.kind === "search"
        ? config.query || "设置搜索主题"
        : config.kind === "capture"
          ? `${config.record ? "录制视频与截图" : "读取网页与截图"} · 最多 ${config.pageLimit} 页`
          : config.kind === "trim"
            ? `${config.start}–${config.end} 秒 · ${config.aspect === "portrait" ? "竖屏" : config.aspect === "landscape" ? "横屏" : "原画幅"}`
            : config.kind === "asset"
              ? config.elementId ? "引用当前画布素材" : "从当前画布选择素材后连接"
              : "截图、视频和介绍回到当前画布";
  return (
    <article
      className="canvas-workflow-node"
      data-state={state}
      data-kind={config.kind}
      data-has-issue={Boolean(issue)}
      data-selected={selected}
      data-connectable={connecting}
      data-workflow-node={node.id}
      aria-label={`${node.title}，${workflowStateLabel[state] ?? state}`}
    >
      <header>
        <span className="canvas-workflow-icon">
          <Icon size={20} />
        </span>
        <div>
          <small>{WORKFLOW_LABELS[config.kind]}</small>
          <strong>{node.title}</strong>
        </div>
      </header>
      {node.pin&&<div className="workflow-pin-badge"><Pin size={11}/>已固定 · 不重复生成</div>}
      {node.note&&<p className="workflow-node-note" title={node.note}>{node.note}</p>}
      {binding.preview?.assetId && binding.preview.mediaType ? <div className="workflow-node-preview"><AuthenticatedRecording assetId={binding.preview.assetId} accessToken={accessToken} kind={binding.preview.mediaType} label={node.title} /></div> : binding.preview?.text ? <div className="workflow-node-text"><MarkdownRenderer text={binding.preview.text}/></div> : <p>{detail}</p>}
      {config.kind === "generate" && <div className="workflow-reference-strip" aria-label="嵌入的参考素材">
        {binding.references?.length ? <><small>参考素材 · {binding.references.length}</small><div>{binding.references.map(reference => <figure key={reference.sourceId}><WorkflowReferenceThumb reference={reference} token={accessToken} /><figcaption>{reference.frameAt !== undefined ? `${reference.frameAt}s 参考帧` : reference.title}</figcaption></figure>)}</div></> : <span><ImageIcon size={16} /> 拖入图片 / 视频作为参考</span>}
      </div>}
      <footer>
        <span className="workflow-node-status" title={issue}><span className="workflow-state-dot" />{issue?"需要完善":workflowStateLabel[state] ?? state}</span>
        <span className="ml-auto flex items-center gap-1">
          {config.kind === "deliver" ? "交付到画布" : outputs ? `${outputs} 个后续步骤` : "连接下一步"}
          <ArrowRight size={13} />
        </span>
      </footer>
      {issue&&<span className="workflow-node-issue" title={issue} aria-label={issue}>!</span>}
      <span className="canvas-workflow-port is-input" />
      <span className="canvas-workflow-port is-output" />
    </article>
  );
}
