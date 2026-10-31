"use client";

import { useState } from "react";
import type { AgentGoalDocument } from "@helstera/shared";

export function AgentDocumentResult({ report, english }: { report: AgentGoalDocument; english: boolean }) {
  const [error, setError] = useState(false);

  function downloadReport() {
    let url: string | undefined;
    const link = document.createElement("a");
    try {
      url = URL.createObjectURL(new Blob([report.content], { type: "text/markdown;charset=utf-8" }));
      link.href = url;
      link.download = report.fileName;
      document.body.append(link);
      link.click();
      setError(false);
    } catch {
      setError(true);
    } finally {
      link.remove();
      // Let the browser consume the URL before releasing the document buffer.
      if (url) {
        const downloadUrl = url;
        const revoke = URL.revokeObjectURL.bind(URL);
        window.setTimeout(() => revoke(downloadUrl), 1_000);
      }
    }
  }

  return <article className="agent-workspace-document">
    <strong>{report.title}</strong>
    <p>{english ? "Editable Markdown · Not automatically saved to your asset folder." : "可编辑 Markdown · 尚未自动保存到素材目录。"}</p>
    <button type="button" onClick={downloadReport}>{english ? "Download Markdown" : "下载 Markdown"}</button>
    {error ? <p role="alert">{english ? "Download could not start. Your report is still available; please retry." : "无法开始下载。报告仍已保留，请重试。"}</p> : null}
  </article>;
}
