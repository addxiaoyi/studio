"use client";

import { useEffect, useState } from "react";
import { fetchJob } from "../lib/server-api";

export type CreatedMedia = { url: string; prompt: string; mimeType: string };
const POLL_DELAY_MS = 3_000;

export function useCreationJob(token: string | undefined, jobId: string | undefined, prompt: string) {
  const [media, setMedia] = useState<CreatedMedia | null>(null);
  const [message, setMessage] = useState("");
  const [finishedId, setFinishedId] = useState<string>();

  useEffect(() => {
    if (!token || !jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setMessage("正在查询生成进度，可在活动记录中找回任务。");
    async function poll() {
      try {
        const { job } = await fetchJob(token!, jobId!, controller.signal);
        if (controller.signal.aborted) return;
        if (job.status === "succeeded") {
          const url = job.result?.signed_url;
          if (typeof url !== "string" || !url) {
            setMessage("任务已完成，但未返回预览地址。请到我的资产查看，请勿重复生成。");
          } else {
            setMedia({ url, prompt, mimeType: String(job.result?.mime_type ?? "application/octet-stream") });
            setMessage("生成完成，已保存到我的资产。");
          }
          setFinishedId(jobId);
          return;
        }
        if (["failed", "dead_letter", "canceled"].includes(job.status)) {
          setMessage(job.error_message || "生成任务已结束，未返回可用结果。请在活动记录核对费用。");
          setFinishedId(jobId);
          return;
        }
        setMessage(job.status === "queued" ? "任务正在排队。" : "正在生成，请稍候。");
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.warn("[creation-job] Status request failed", cause);
        setMessage("暂时无法读取任务状态，正在重试。请勿重复生成。");
      }
      timer = setTimeout(() => void poll(), POLL_DELAY_MS);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, jobId, prompt]);

  return { media, message, finished: Boolean(jobId && finishedId === jobId) };
}
