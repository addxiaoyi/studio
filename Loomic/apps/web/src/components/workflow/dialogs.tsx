"use client";
import {
  WORKFLOW_LABELS,
  type GoalExecutionPlan,
  type WorkflowGraph,
} from "@helstera/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Props = {
  proposal: { graph: WorkflowGraph; summary: string } | null;
  title: string;
  revision?: number | undefined;
  plan: GoalExecutionPlan | null;
  confirmRun: boolean;
  busy: boolean;
  discard(): void;
  apply(): void;
  setConfirmRun(open: boolean): void;
  run(): void;
};
export function WorkflowDialogs({
  proposal,
  title,
  revision,
  plan,
  confirmRun,
  busy,
  discard,
  apply,
  setConfirmRun,
  run,
}: Props) {
  return (
    <>
      <Dialog
        open={Boolean(proposal)}
        onOpenChange={(open) => {
          if (!open) discard();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>检查 AI 工作流方案</DialogTitle>
            <DialogDescription>{proposal?.summary}</DialogDescription>
          </DialogHeader>
          {proposal && (
            <>
              <p className="text-sm">
                {proposal.graph.nodes.length}{" "}
                个节点将放入当前画布。应用不会开始执行。
              </p>
              <ol className="max-h-64 list-decimal overflow-auto pl-5 text-sm space-y-2">
                {proposal.graph.nodes.map((node) => (
                  <li key={node.id}>
                    {node.title} · {WORKFLOW_LABELS[node.config.kind]}
                  </li>
                ))}
              </ol>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={discard}>
              放弃方案
            </Button>
            <Button disabled={busy} onClick={apply}>
              应用到草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认运行「{title}」</DialogTitle>
            <DialogDescription>
              执行已保存的第 {revision} 版。录制和剪辑仍需逐项确认。
            </DialogDescription>
          </DialogHeader>
          <ol className="max-h-64 overflow-auto list-decimal pl-5 text-sm space-y-2">
            {plan?.steps.map((step) => (
              <li key={step.id}>
                {step.title}
                {step.command.executor === "web.capture"
                  ? ` · ${step.command.url ?? "搜索结果"} · ${step.command.record ? "录制" : "截图"}`
                  : step.command.executor === "media.trim"
                    ? ` · ${step.command.start}–${step.command.end} 秒`
                    : ""}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            素材会重新验证权限；这些节点不调用付费生成模型。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(false)}>
              返回编辑
            </Button>
            <Button disabled={busy} onClick={run}>
              确认运行已保存版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
