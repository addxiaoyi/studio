"use client";
import { Button } from "@/components/ui/button";
import type { WorkflowPreflight } from "@helstera/shared";

export function WorkflowPreflightList({
  report,
  error,
  checking,
  retry,
  locate,
}: {
  report: WorkflowPreflight | null;
  error: string;
  checking: boolean;
  retry(): void;
  locate(nodeId: string | null): void;
}) {
  return (
    <section aria-label="运行前检查" className="space-y-3 text-sm">
      {checking && <output>正在检查素材权限、编剧连接、媒体模型和价格…</output>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {report && (
        <>
          <output>
            {report.ready
              ? "本次执行范围的运行前检查已通过。"
              : `运行前需要修复 ${report.issues.length} 项问题。`}
          </output>
          {report.issues.length > 0 && (
            <ul
              className="max-h-60 space-y-2 overflow-y-auto"
              aria-label="阻断问题"
            >
              {report.issues.map((issue) => (
                <li
                  key={`${issue.nodeId}:${issue.code}:${issue.message}`}
                  className="rounded-lg border p-3 break-words"
                >
                  <p className="font-medium">{issue.title}</p>
                  <p>{issue.message}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => locate(issue.nodeId)}
                    className="mt-2 h-auto min-h-9 whitespace-normal text-left"
                  >
                    {issue.action}
                    {issue.nodeId ? " · 定位节点" : " · 返回编辑"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {report.quotes.length > 0 && (
            <div className="space-y-2">
              <p className="font-medium">生成节点参考费用</p>
              <ul className="space-y-1 break-words">
                {report.quotes.map((quote) => (
                  <li key={quote.nodeId}>
                    {quote.title} · {quote.model} · {quote.credits} 积分
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                按当前参数检查，每个实际执行的生成节点仍需单独确认费用；模型或价格变化时会重新校验。
              </p>
            </div>
          )}
        </>
      )}
      {!checking && (
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          重新检查
        </Button>
      )}
    </section>
  );
}
