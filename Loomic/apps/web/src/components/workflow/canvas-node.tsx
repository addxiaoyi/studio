"use client";
import {
  ArrowRight,
  Film,
  Globe,
  ImageIcon,
  PackageCheck,
  Scissors,
  Search,
} from "lucide-react";
import { WORKFLOW_LABELS } from "@helstera/shared";
import { workflowBinding, type SceneElement } from "./scene";
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
  url: Globe,
  search: Search,
  capture: Film,
  trim: Scissors,
  deliver: PackageCheck,
  asset: ImageIcon,
};
export function WorkflowCanvasNode({ element }: { element: SceneElement }) {
  const binding = workflowBinding(element);
  if (!binding) return null;
  const { node, state } = binding,
    config = node.config,
    Icon = icons[config.kind];
  const detail =
    config.kind === "url"
      ? config.url || "设置目标网址"
      : config.kind === "search"
        ? config.query || "设置搜索主题"
        : config.kind === "capture"
          ? `${config.record ? "录制视频与截图" : "读取网页与截图"} · 最多 ${config.pageLimit} 页`
          : config.kind === "trim"
            ? `${config.start}–${config.end} 秒 · ${config.aspect === "portrait" ? "竖屏" : config.aspect === "landscape" ? "横屏" : "原画幅"}`
            : config.kind === "asset"
              ? "引用当前画布素材"
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
      <p>{detail}</p>
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
