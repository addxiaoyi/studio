"use client";
import {
  ArrowRight,
  Film,
  Globe,
  ImageIcon,
  PackageCheck,
  Scissors,
  Search,
  FileText, Sparkles, Clapperboard, Wand2, Layers, Camera,
} from "lucide-react";
import { WORKFLOW_LABELS } from "@helstera/shared";
import { workflowBinding, type SceneElement } from "./scene";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";
import {MarkdownRenderer} from "@/components/chat/markdown-renderer";
import "./workflow.css";

export const workflowStateLabel: Record<string, string> = {
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
  text:FileText,write:Sparkles,shot:Clapperboard,generate:Wand2,compose:Layers,frame:Camera,
  url: Globe,
  search: Search,
  capture: Film,
  trim: Scissors,
  deliver: PackageCheck,
  asset: ImageIcon,
};
export function WorkflowCanvasNode({ element, accessToken }: { element: SceneElement; accessToken: string }) {
  const binding = workflowBinding(element);
  if (!binding) return null;
  const { node, state } = binding,
    config = node.config,
    Icon = icons[config.kind];
  const detail =
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
      {binding.preview?.assetId && binding.preview.mediaType ? <div className="workflow-node-preview"><AuthenticatedRecording assetId={binding.preview.assetId} accessToken={accessToken} kind={binding.preview.mediaType} label={node.title} /></div> : binding.preview?.text ? <div className="workflow-node-text"><MarkdownRenderer text={binding.preview.text}/></div> : <p>{detail}</p>}
      <footer>
        <span className="workflow-state-dot" />
        <span>{workflowStateLabel[state] ?? state}</span>
        <span className="ml-auto flex items-center gap-1">
          {config.kind === "deliver" ? "交付" : "连接下一步"}
          <ArrowRight size={13} />
        </span>
      </footer>
      <span className="canvas-workflow-port is-input" />
      <span className="canvas-workflow-port is-output" />
    </article>
  );
}
