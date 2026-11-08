"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { WORKFLOW_LABELS } from "@helstera/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { workflowConfigs } from "./use-workflow-controller";
const groups = [
  { title: "创作与生成", kinds: ["text", "write", "shot", "generate"] },
  { title: "视频处理", kinds: ["frame", "trim", "compose"] },
  { title: "网站与交付", kinds: ["url", "search", "capture", "deliver"] },
] as const;
const descriptions: Record<string, string> = {
  text: "故事、角色与提示词",
  write: "使用本站 Agent 改写、编剧、分镜",
  shot: "从分镜中提取一个镜头",
  generate: "使用参考素材生成图片或视频",
  frame: "从视频指定时刻提取图片",
  trim: "截取片段并调整画幅",
  compose: "依次拼接多个视频",
  url: "网站地址",
  search: "搜索公开网页",
  capture: "浏览、截图或录制网站",
  deliver: "将结果保存到画布与对话",
};
export function WorkflowNodePicker({
  open,
  onClose,
  onAdd,
  disabled,
  anchor,
}: {
  open: boolean;
  onClose(): void;
  onAdd(kind: string): void;
  disabled: boolean;
  anchor?: string | undefined;
}) {
  const [query, setQuery] = useState("");
  const matched = (kind: string) =>
    `${WORKFLOW_LABELS[kind as keyof typeof workflowConfigs]} ${descriptions[kind]}`.includes(
      query.trim(),
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setQuery("");
          onClose();
        }
      }}
    >
      <DialogContent className="workflow-node-picker">
        <DialogHeader>
          <DialogTitle>添加处理节点</DialogTitle>
          <DialogDescription>
            {anchor
              ? `接在「${anchor}」之后，兼容的输入会自动连接。`
              : "选择要添加到当前画布的步骤。"}
          </DialogDescription>
        </DialogHeader>
        <label className="workflow-picker-search">
          <Search size={16} />
          <input
            autoFocus
            aria-label="搜索节点"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索生成、裁剪、录制…"
          />
        </label>
        {groups.map((group) => {
          const kinds = group.kinds.filter(matched);
          return kinds.length ? (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <div>
                {kinds.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    disabled={disabled}
                    onClick={() => onAdd(kind)}
                  >
                    <strong>{WORKFLOW_LABELS[kind]}</strong>
                    <span>{descriptions[kind]}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null;
        })}
        {!groups.some((group) => group.kinds.some(matched)) && (
          <p role="status">没有匹配的节点，试试“视频”或“生成”。</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
