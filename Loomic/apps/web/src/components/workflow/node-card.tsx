"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ArrowUpRight,
  Globe,
  Search,
  Film,
  Scissors,
  PackageCheck,
} from "lucide-react";
import { WORKFLOW_LABELS, type WorkflowNode } from "@helstera/shared";
export type FlowNode = Node<
  { node: WorkflowNode; status: string; issue?: string },
  "workflow"
>;
const icons = {
  url: Globe,
  search: Search,
  capture: Film,
  trim: Scissors,
  deliver: PackageCheck,
};
const stateText: Record<string, string> = {
  queued: "待执行",
  running: "执行中",
  succeeded: "已完成",
  waiting_approval: "等待确认",
  failed: "失败",
  review: "待核验",
  canceled: "已取消",
  paused: "已暂停",
  draft: "草稿",
};
export const WorkflowNodeCard = memo(function WorkflowNodeCard({
  data,
  selected,
}: NodeProps<FlowNode>) {
  const { node, status, issue } = data,
    config = node.config,
    Icon = icons[config.kind];
  const detail =
    config.kind === "url"
      ? config.url || "请填写网址"
      : config.kind === "search"
        ? config.query || "请填写搜索主题"
        : config.kind === "capture"
          ? `${config.record ? "录制与截图 · 运行时确认" : "读取与截图"} · ${config.pageLimit}页`
          : config.kind === "trim"
            ? `${config.start}–${config.end}秒 · 导出前确认`
            : "素材、文档回到当前画布";
  return (
    <article
      className={`workflow-node ${selected ? "is-selected" : ""}`}
      data-state={status}
      aria-label={`${node.title}，${stateText[status] ?? status}`}
    >
      {!["url", "search"].includes(config.kind) && (
        <Handle
          type="target"
          position={Position.Left}
          aria-label={`${node.title}输入`}
        />
      )}
      <header>
        <span className="workflow-node-icon">
          <Icon size={17} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <small>{WORKFLOW_LABELS[config.kind]}</small>
          <strong>{node.title}</strong>
        </span>
        <ArrowUpRight
          size={13}
          className="ml-auto text-muted-foreground"
          aria-hidden="true"
        />
      </header>
      <p className="workflow-node-detail">{detail}</p>
      <footer>
        <span className="workflow-state-dot" />
        <span>{stateText[status] ?? status}</span>
        {issue && <span className="ml-auto text-destructive">需完善</span>}
      </footer>
      {config.kind !== "deliver" && (
        <Handle
          type="source"
          position={Position.Right}
          aria-label={`${node.title}输出`}
        />
      )}
    </article>
  );
});
