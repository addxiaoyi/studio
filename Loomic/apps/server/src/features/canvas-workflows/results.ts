import type { Pool } from "pg";
import type { WorkflowNode } from "@helstera/shared";
import type { StorageProvider } from "../../storage/storage-provider.js";
import { CanvasWorkflowService, WorkflowError } from "./service.js";
import {
  insertLocalImageElement,
  insertLocalVideoElement,
} from "../canvas/canvas-element-writer.js";
import sharp from "sharp";

type ResultAsset = {
  id: string;
  mediaType: "image" | "video";
  available: boolean;
};
export async function workflowResults(
  db: Pool,
  userId: string,
  canvasId: string,
  workflowId: string,
  goalId: string,
) {
  await new CanvasWorkflowService(db).get(userId, canvasId, workflowId);
  const run = (
    await db.query(
      "select r.revision,r.created_at,r.graph,g.status,g.workspace_id from canvas_workflow_runs r join agent_goals g on g.id=r.goal_id where r.workflow_id=$1 and r.goal_id=$2 and g.created_by=$3",
      [workflowId, goalId, userId],
    )
  ).rows[0];
  if (!run) throw new WorkflowError("运行记录不存在。", 404);
  const steps = (
    await db.query<{
      step_id: string;
      title: string;
      state: string;
      output: Record<string, unknown> | null;
    }>(
      "select step_id,title,state,output from agent_goal_steps where goal_id=$1 order by ordinal",
      [goalId],
    )
  ).rows;
  const results = [];
  for (const step of steps) {
    if (step.state !== "succeeded" || !step.output) continue;
    const output = step.output;
    const candidates: Array<{ id: unknown; mediaType: unknown }> =
      Array.isArray(output.assets)
        ? (output.assets as Array<{ id: unknown; mediaType: unknown }>)
        : [];
    if (Array.isArray(output.pages))
      for (const page of output.pages as Array<{ assetId?: string }>)
        if (page.assetId)
          candidates.push({ id: page.assetId, mediaType: "image" });
    if (
      typeof output.recordingAssetId === "string" &&
      !candidates.some((asset) => asset.id === output.recordingAssetId)
    )
      candidates.push({ id: output.recordingAssetId, mediaType: "video" });
    const assets: ResultAsset[] = [];
    for (const item of candidates.slice(0, 8)) {
      if (
        typeof item.id !== "string" ||
        !/^[-a-f\d]{36}$/i.test(item.id) ||
        !["image", "video"].includes(String(item.mediaType))
      )
        continue;
      const exists = (
        await db.query(
          `select ao.id from asset_objects ao left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
        where (ao.id=$1 or ga.id=$1) and ao.workspace_id=$2 and ao.created_by=$3 and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))`,
          [item.id, run.workspace_id, userId],
        )
      ).rows[0];
      assets.push({
        id: exists?.id ?? item.id,
        mediaType: item.mediaType as "image" | "video",
        available: Boolean(exists),
      });
    }
    const text =
      typeof output.text === "string"
        ? output.text
        : typeof output.summary === "string"
          ? output.summary
          : typeof output.introduction === "string"
            ? output.introduction
            : "";
    const node = (run.graph.nodes as WorkflowNode[]).find(
      (node) => node.id === step.step_id,
    );
    if (text || assets.length)
      results.push({
        nodeId: step.step_id,
        title: step.title,
        text: text.slice(0, 16000),
        assets,
        config: node?.config ?? null,
      });
  }
  return {
    goalId,
    revision: Number(run.revision),
    createdAt: run.created_at.toISOString(),
    status: run.status,
    results,
  };
}

export async function reuseWorkflowResult(
  db: Pool,
  storage: StorageProvider | undefined,
  userId: string,
  canvasId: string,
  workflowId: string,
  input: { goalId: string; nodeId: string; assetId?: string | undefined },
) {
  const run = await workflowResults(
    db,
    userId,
    canvasId,
    workflowId,
    input.goalId,
  );
  const source = run.results.find((item) => item.nodeId === input.nodeId);
  if (!source) throw new WorkflowError("没有可复用的完成结果。");
  const id = `reuse-${crypto.randomUUID()}`;
  if (!input.assetId) {
    if (!source.text) throw new WorkflowError("这个结果没有文字内容。");
    return {
      id,
      title: `${source.title} · 已有结果`.slice(0, 100),
      position: { x: 0, y: 0 },
      config: {
        kind: "text",
        role: "prompt",
        text: source.text.slice(0, 12000),
      },
    } satisfies WorkflowNode;
  }
  const asset = source.assets.find(
    (item) => item.id === input.assetId && item.available,
  );
  if (!asset) throw new WorkflowError("结果素材已到期、删除或无权使用。", 409);
  const row = (
    await db.query(
      `select ao.bucket,ao.object_path,ao.mime_type,c.content from asset_objects ao join canvases c on c.id=$2 join projects p on p.id=c.project_id
      left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
      where ao.id=$1 and ao.workspace_id=p.workspace_id and ao.created_by=$3 and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))`,
      [asset.id, canvasId, userId],
    )
  ).rows[0];
  if (!row) throw new WorkflowError("素材已不可用。", 409);
  const existing = (
    row.content?.elements as
      | Array<{
          id: string;
          x: number;
          y: number;
          isDeleted?: boolean;
          customData?: { assetId?: string };
        }>
      | undefined
  )?.find((el) => !el.isDeleted && el.customData?.assetId === asset.id);
  let elementId = existing?.id;
  const jobId = `workflow-reuse:${input.goalId}:${input.nodeId}:${asset.id}`;
  if (!elementId) {
    if (asset.mediaType === "image") {
      if (
        !storage ||
        !["project-assets", "private-try-on"].includes(row.bucket)
      )
        throw new WorkflowError("图片素材暂不能回到画布。");
      const media = await storage.download(row.bucket, row.object_path);
      if (media.error || !media.data || media.data.length > 40 * 1024 * 1024)
        throw new WorkflowError("图片读取失败或超过大小限制。");
      const metadata = await sharp(media.data, {
        limitInputPixels: 64 * 1024 * 1024,
      }).metadata();
      if (!metadata.width || !metadata.height)
        throw new WorkflowError("无法读取图片尺寸。");
      elementId = (
        await insertLocalImageElement(
          db,
          { download: async () => media },
          {
            canvasId,
            objectPath: row.object_path,
            bucket: row.bucket,
            width: metadata.width,
            height: metadata.height,
            mimeType: row.mime_type,
            title: source.title,
            assetId: asset.id,
            jobId,
          },
        )
      ).elementId;
    } else
      elementId = (
        await insertLocalVideoElement(db, {
          canvasId,
          signedUrl: `/api/uploads/${asset.id}/file`,
          width: 960,
          height: 540,
          mimeType: "video/mp4",
          title: source.title,
          assetId: asset.id,
          jobId,
        })
      ).elementId;
  }
  const scene = (
    await db.query("select content from canvases where id=$1", [canvasId])
  ).rows[0].content;
  const element = (
    scene.elements as Array<{
      id: string;
      x: number;
      y: number;
      isDeleted?: boolean;
    }>
  ).find((el) => el.id === elementId && !el.isDeleted);
  if (!element)
    throw new WorkflowError("原结果已从画布删除，请从素材库重新导入。", 409);
  return {
    id,
    title: source.title.slice(0, 100),
    position: { x: element.x, y: element.y },
    config: {
      kind: "asset",
      elementId: element.id,
      assetId: asset.id,
      mediaType: asset.mediaType,
    },
  } satisfies WorkflowNode;
}
