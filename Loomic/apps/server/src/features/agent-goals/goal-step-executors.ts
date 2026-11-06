import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";
import type { WebsiteAssistantHub } from "../website-capture/assistant-hub.js";
import { captureIsolatedWebsite, validatePublicHttpUrl } from "../website-capture/isolated-browser.js";
import { buildWebsiteDocument } from "./agent-goal-document.js";
import { writeCaptureToCanvas } from "./agent-goal-background.js";
import { insertLocalImageElement, insertLocalVideoElement } from "../canvas/canvas-element-writer.js";
import { assertConnectorEnabled } from "./connector-gate.js";
import { runOneTake } from "../onetake/runner.js";
import { savePrivateVideo } from "../assets/private-video.js";
import { StepWaiting, type StepExecutor } from "./goal-step-worker.js";

type Options = { db: Pool; storage: StorageProvider; storageRoot: string; webOrigin: string; desktop: WebsiteAssistantHub };
export function createGoalStepExecutor(options: Options): StepExecutor {
  return async input => {
    const { step, goal, previous, signal, assertActive } = input;
    const command = step.command;
    if (command.executor.startsWith("web.")) await assertConnectorEnabled(options.db, goal.workspace_id, goal.created_by, "isolated-browser");
    if (command.executor === "web.search") {
      const response = await fetch("https://html.duckduckgo.com/html/?" + new URLSearchParams({ q: command.query }), { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error" });
      if (!response.ok) throw new Error("网页搜索暂不可用，请提供网址后重试。");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("搜索未返回内容。");
      let html = ""; let bytes = 0; const decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 2_000_000) throw new Error("搜索结果超出大小限制。"); html += decoder.decode(chunk.value, { stream: true }); } } finally { await reader.cancel(); }
      const candidates = [...html.matchAll(/href="([^"<>]+)"[^>]*class="result__a"|class="result__a"[^>]*href="([^"<>]+)"/g)];
      for (const match of candidates) {
        const link = new URL((match[1] ?? match[2]!).replaceAll("&amp;", "&"), "https://html.duckduckgo.com");
        const target = link.searchParams.get("uddg") ?? link.href;
        try { const url = await validatePublicHttpUrl(target); return { query: command.query, url: url.href, source: "DuckDuckGo", observedAt: new Date().toISOString() }; } catch { /* Skip search redirects and non-public destinations. */ }
      }
      throw new Error("搜索未找到可访问的公开网址。请补充网址或具体主题。");
    }
    if (command.executor === "web.capture") {
      if (!command.url) throw new Error("浏览步骤尚未解析网址。");
      if (command.record && step.approval !== "consumed") throw new Error("录制动作尚未批准。");
      const existing = (await options.db.query<{ status: string; result: Record<string, unknown> }>("select status,result from website_capture_tasks where id=$1", [step.id])).rows[0];
      if (existing?.status === "succeeded" && existing.result) return existing.result;
      await options.db.query(`insert into website_capture_tasks(id,workspace_id,created_by,session_id,mode,start_url,page_limit,record_video,follow_external,idempotency_key,status,stage)
        values($1,$2,$3,$4,'isolated',$5,$6,$7,false,$8,'running','connecting') on conflict(id) do update set status='running',stage='connecting',updated_at=now()`, [step.id, goal.workspace_id, goal.created_by, goal.chat_session_id, command.url, command.pageLimit, command.record, `goal-step:${step.id}`]);
      const captured = await captureIsolatedWebsite({ ...options, signal, task: { id: step.id, workspace_id: goal.workspace_id, created_by: goal.created_by, start_url: command.url, page_limit: command.pageLimit, record_video: command.record, follow_external: false }, onProgress: async (progress, stage, detail) => {
        await assertActive(); await assertConnectorEnabled(options.db, goal.workspace_id, goal.created_by, "isolated-browser");
        await options.db.query("update website_capture_tasks set progress=$2,stage=$3,updated_at=now() where id=$1", [step.id, progress, stage]);
        await options.db.query("insert into agent_goal_events(goal_id,event_type,detail,payload) values($1,'goal.step_progress',$2,$3::jsonb)", [goal.id, detail ?? stage, JSON.stringify({ stepId: step.step_id, progress, stage })]);
      } });
      if (!captured.pages.length || command.record && !captured.recordingAssetId) throw new Error("浏览或录制缺少完成证据。");
      await assertActive();
      await options.db.query("update website_capture_tasks set status='succeeded',progress=100,result=$2::jsonb,completed_at=now(),updated_at=now() where id=$1", [step.id, JSON.stringify(captured)]);
      return captured as unknown as Record<string, unknown>;
    }
    if (command.executor === "media.trim") {
      if (step.approval !== "consumed") throw new Error("剪辑导出尚未批准。");
      const source = previous.find(item => item.step_id === command.fromStep)?.output;
      const assetId = source?.recordingAssetId;
      if (typeof assetId !== "string") throw new Error("前一步没有可用录制。");
      if (assetId !== command.sourceAssetId) throw new Error("录制来源与批准的文件不一致。");
      const asset = (await options.db.query("select ao.bucket,ao.object_path from asset_objects ao left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path where (ao.id=$1 or ga.id=$1) and ao.workspace_id=$2 and ao.created_by=$3", [assetId, goal.workspace_id, goal.created_by])).rows[0];
      if (!asset) throw new Error("录制素材不可用。");
      const media = await options.storage.download(asset.bucket, asset.object_path);
      if (!media.data || media.error) throw new Error("无法读取录制素材。");
      const base = join(options.storageRoot, "goal-exports"); await mkdir(base, { recursive: true });
      const folder = await mkdtemp(join(base, "render-"));
      try {
        const sourcePath = join(folder, "source.webm"), output = join(folder, "output.mp4");
        await writeFile(sourcePath, media.data, { flag: "wx" });
        await runOneTake({ operation: "export", source: sourcePath, output, options: { format: "mp4", quality: "medium", aspect: command.aspect, subtitle: { enabled: false } }, compiled: { segments: [{ start: command.start, end: command.end }], duration: command.end - command.start, srt: "" } }, signal);
        await assertActive();
        const saved = await savePrivateVideo(options.db, options.storage, { workspaceId: goal.workspace_id, userId: goal.created_by, uploadId: step.id, bytes: await readFile(output), mimeType: "video/mp4" });
        return { summary: "录制剪辑已生成。", recordingAssetId: saved.assetId, assets: [{ id: saved.assetId, mediaType: "video", url: `/api/uploads/${saved.assetId}/file` }] };
      } finally { await rm(folder, { recursive: true, force: true }); }
    }
    if (command.executor === "desktop.actions") {
      await assertConnectorEnabled(options.db, goal.workspace_id, goal.created_by, "desktop-agent");
      let taskId = step.output?.taskId;
      if (typeof taskId !== "string") {
        // A step interrupted between dispatch and checkpoint is recovered by its deterministic marker.
        const marker = `goal-step:${step.id}`;
        const existing = (await options.db.query("select id from desktop_agent_tasks where goal_id=$1 and id=$2", [goal.id, step.id])).rows[0];
        if (existing) taskId = existing.id;
        else { try { const created = await options.desktop.createDesktopAgentTask(goal.created_by, goal.workspace_id, { ...command.request, goal: `${command.request.goal}\n${marker}`, ...(goal.canvas_id ? { canvasId: goal.canvas_id } : {}) }, goal.chat_session_id ?? undefined, goal.id, step.id); taskId = created.taskId; } catch (error) { if (error instanceof Error && /未连接|not connected/i.test(error.message)) throw new StepWaiting({}); throw error; } }
      }
      const task = (await options.db.query("select status,result,error_message from desktop_agent_tasks where id=$1 and goal_id=$2", [taskId, goal.id])).rows[0];
      if (!task) throw new Error("桌面步骤没有派发回执。");
      if (task.status === "succeeded") return { ...(task.result ?? {}), taskId, localSaveVerified: false };
      if (["failed", "canceled"].includes(task.status)) throw new Error(task.error_message ?? "桌面步骤未完成。");
      throw new StepWaiting({ taskId }, task.status === "waiting_approval" ? "waiting_approval" : "waiting_desktop");
    }
    const sources = previous.filter(item => command.sources.includes(item.step_id));
    const documents = [], assets: Array<{ id: string; url?: string | undefined; mediaType: string }> = [], canvasElementIds: string[] = [];
    for (const source of sources) {
      const output = source.output;
      if (!output) throw new Error("结果来源缺少完成回执。");
      if (source.executor === "web.capture") {
        const capture = output as unknown as Awaited<ReturnType<typeof captureIsolatedWebsite>>;
        documents.push(buildWebsiteDocument(`${goal.id}-${source.step_id}`, capture));
        assets.push(...capture.pages.map(page => ({ id: page.assetId, url: page.screenshotUrl, mediaType: "image" })));
        if (capture.recordingAssetId) assets.push({ id: capture.recordingAssetId, url: capture.recordingUrl, mediaType: "video" });
        if (goal.canvas_id) canvasElementIds.push(...await writeCaptureToCanvas({ db: options.db, storage: options.storage, writer: { insertImage: insertLocalImageElement, insertVideo: insertLocalVideoElement }, canvasId: goal.canvas_id, taskId: source.id, workspaceId: goal.workspace_id, pages: capture.pages, recordingAssetId: capture.recordingAssetId, recordingUrl: capture.recordingUrl, beforeWrite: assertActive }));
      } else if (Array.isArray(output.assets)) {
        assets.push(...output.assets as typeof assets);
        if (goal.canvas_id && source.executor === "media.trim" && typeof output.recordingAssetId === "string") {
          await assertActive();
          const inserted = await insertLocalVideoElement(options.db, { canvasId: goal.canvas_id, signedUrl: `/api/uploads/${output.recordingAssetId}/file`, width: source.command.executor === "media.trim" && source.command.aspect === "portrait" ? 720 : 1280, height: source.command.executor === "media.trim" && source.command.aspect === "portrait" ? 1280 : 720, mimeType: "video/mp4", title: "目标剪辑成片", assetId: output.recordingAssetId, jobId: `${source.id}:trim-output` });
          canvasElementIds.push(inserted.elementId);
        }
      }
    }
    await assertActive();
    return { summary: documents.map(document => document.content).join("\n\n") || "所有已确认步骤已完成，结果已保存。", documents, assets, canvasElementIds, saveState: assets.length ? "cloud" : "pending", localSaveVerified: false };
  };
}
