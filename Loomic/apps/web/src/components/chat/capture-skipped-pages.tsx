"use client";
import type { WebsiteCaptureResult } from "@helstera/shared";
import { openAgentBrowser } from "@/lib/agent-browser-api";
import { Button } from "@/components/ui/button";

export function CaptureSkippedPages({ result, taskId }: { result: WebsiteCaptureResult; taskId: string }) {
  if (!result.skippedPages?.length) return null;
  function retryPage(url: string) {
    openAgentBrowser(taskId);
    window.dispatchEvent(new CustomEvent("loomic:website-retry-page", { detail: { url } }));
  }
  return <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" aria-label="未完成的页面">
    <h3 className="text-sm font-medium">以下页面未进入录像</h3>
    <ul className="space-y-3">{result.skippedPages.map(page => <li key={page.url} className="space-y-1">
      <p className="break-all text-xs">{page.url}</p>
      <p className="text-xs text-muted-foreground">{page.reason}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => retryPage(page.url)}>重新准备此页录制</Button>
    </li>)}</ul>
  </section>;
}
