"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { WORKFLOW_LABELS, insertWorkflowNode, type WorkflowGraph } from "@helstera/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { workflowConfigs } from "./use-workflow-controller";
const groups = [
  {title:"逻辑与数据",kinds:["condition","json","extract","transform","template","merge","delay"]},
  { title: "创作与生成", kinds: ["text", "write", "shot", "generate"] },
  { title: "视频处理", kinds: ["frame", "trim", "compose"] },
  { title: "网站与交付", kinds: ["url", "search", "capture", "deliver"] },
] as const;
const descriptions: Record<string, string> = {
  condition:"按条件选择“是”或“否”分支",json:"创建结构化 JSON 输入",extract:"读取 JSON 中的指定字段",transform:"去空白、大小写或替换文字",template:"使用 {{text}} 组织文字内容",merge:"按输入顺序合并命中的文字分支",delay:"等待指定秒数，刷新后可继续",
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
  insertion,
}: {
  open: boolean;
  onClose(): void;
  onAdd(kind: string): void;
  disabled: boolean;
  anchor?: string | undefined;
  insertion?: { graph:WorkflowGraph;edgeId:string } | undefined;
}) {
  const [query, setQuery] = useState("");
  const [candidateIds]=useState(()=>({node:`candidate-${crypto.randomUUID()}`,edge:`candidate-${crypto.randomUUID()}`}));
  const compatibility=(kind: keyof typeof workflowConfigs)=>{
    if(!insertion)return null;
    try{insertWorkflowNode(insertion.graph,insertion.edgeId,{id:candidateIds.node,title:"候选节点",position:{x:0,y:0},config:workflowConfigs[kind]},candidateIds.edge);return null;}
    catch(cause){return cause instanceof Error?cause.message:"当前连线不兼容";}
  };
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
            {insertion ? "插入后会自动接好前后两条线，不兼容的节点不可选择。" : anchor
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
                    disabled={disabled || Boolean(compatibility(kind))}
                    title={compatibility(kind)??descriptions[kind]}
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
