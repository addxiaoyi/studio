import type { CanvasContent, WebsiteCaptureResult } from "@helstera/shared";
import type { Pool } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";
import { buildImageElement, buildVideoElement, calculateAutoPlacement } from "../canvas/canvas-element-writer.js";

type Delivery = NonNullable<WebsiteCaptureResult["canvasDelivery"]>;
type AssetRow = { id: string; bucket: string; object_path: string; mime_type: string; metadata: Record<string, unknown> };
type CaptureRow = { result: WebsiteCaptureResult; created_by: string; workspace_id: string; session_id: string | null };

export async function deliverCaptureToCanvas(db: Pool, storage: StorageProvider, taskId: string, ownerId?: string): Promise<Delivery> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const task = (await client.query<CaptureRow>(
      "select result,created_by,workspace_id,session_id from website_capture_tasks t where id=$1 and status='succeeded' and ($2::uuid is null or created_by=$2) and exists(select 1 from workspace_members m where m.workspace_id=t.workspace_id and m.user_id=t.created_by) for update",
      [taskId, ownerId ?? null],
    )).rows[0];
    if (!task?.result) throw new Error("浏览任务尚未完成或无权访问。");
    if (task.result.canvasDelivery?.status === "succeeded") {
      await client.query("commit");
      return task.result.canvasDelivery;
    }
    if (!task.session_id) {
      const delivery: Delivery = { status: "unlinked", elementIds: [] };
      await client.query("update website_capture_tasks set result=jsonb_set(result,'{canvasDelivery}',$2::jsonb),updated_at=now() where id=$1", [taskId, JSON.stringify(delivery)]);
      await client.query("commit");
      return delivery;
    }
    const canvas = (await client.query<{ id: string; content: CanvasContent }>(
      `select c.id,c.content from chat_sessions s join canvases c on c.id=s.canvas_id
       join projects p on p.id=c.project_id join workspace_members m on m.workspace_id=p.workspace_id
       where s.id=$1 and s.created_by=$2 and p.workspace_id=$3 and m.user_id=$2 for update of c`,
      [task.session_id, task.created_by, task.workspace_id],
    )).rows[0];
    if (!canvas) throw new Error("任务关联画布已不可用或权限已撤销。");
    const requested = [...task.result.pages.map(page => page.assetId), ...(task.result.recordingAssetId ? [task.result.recordingAssetId] : [])];
    const assets = (await client.query<AssetRow>(
      `select a.id,a.bucket,a.object_path,a.mime_type,g.metadata from asset_objects a
       join generated_assets g on g.workspace_id=a.workspace_id and g.object_path=a.object_path
       where a.id=any($1::uuid[]) and a.workspace_id=$2 and a.created_by=$3
         and g.website_capture_task_id=$4 and g.deleted_at is null
         and g.retention_state='active' and g.retention_until>now()`,
      [requested, task.workspace_id, task.created_by, taskId],
    )).rows;
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    if (requested.some(id => !byId.has(id))) throw new Error("部分录制素材已删除、到期或无权访问，未添加到画布。");
    const content = canvas.content ?? { elements: [], appState: {} };
    const elements = [...(content.elements ?? [])] as Record<string, unknown>[];
    const files = { ...((content as CanvasContent & { files?: Record<string, unknown> }).files ?? {}) };
    const elementIds: string[] = [];
    for (const id of requested) {
      const prior = elements.find(element => (element.customData as Record<string, unknown> | undefined)?.assetId === id);
      if (prior) { elementIds.push(String(prior.id)); continue; }
      const asset = byId.get(id)!;
      const page = task.result.pages.find(page => page.assetId === id);
      const title = page ? `网页截图 · ${page.title}` : `网站录像 · ${task.result.title}`;
      const width = Number(asset.metadata?.width) || 1280;
      const height = Number(asset.metadata?.height) || 720;
      const video = id === task.result.recordingAssetId;
      const placement = calculateAutoPlacement(elements, width, height, video ? 800 : 600);
      const options = { canvasId: canvas.id, assetId: id, title, mimeType: asset.mime_type, width, height };
      let element: Record<string, unknown>;
      if (video) {
        if (!asset.mime_type.startsWith("video/")) throw new Error("录像素材类型不正确。");
        element = buildVideoElement(placement, { ...options, signedUrl: `/api/uploads/${id}/file`, ...(task.result.recordingDurationSeconds ? { durationSeconds: task.result.recordingDurationSeconds } : {}) });
      } else {
        if (!asset.mime_type.startsWith("image/")) throw new Error("截图素材类型不正确。");
        const download = await storage.download(asset.bucket, asset.object_path);
        if (download.error || !download.data?.length) throw new Error("截图读取失败，已保留录制结果，请重试添加。");
        if (download.data.length > 8 * 1024 * 1024) throw new Error("截图文件过大，未添加到画布。");
        const fileId = `capture-${id}`;
        files[fileId] = { id: fileId, mimeType: asset.mime_type, dataURL: `data:${asset.mime_type};base64,${download.data.toString("base64")}`, created: Date.now() };
        element = buildImageElement(fileId, placement, { ...options, objectPath: asset.object_path });
      }
      element.customData = { ...(element.customData as Record<string, unknown>), websiteCaptureTaskId: taskId, timelineIncluded: false };
      elements.push(element);
      elementIds.push(String(element.id));
    }
    const delivery: Delivery = { status: "succeeded", canvasId: canvas.id, elementIds };
    await client.query("update canvases set content=$2::jsonb,version=version+1,updated_at=now() where id=$1", [canvas.id, JSON.stringify({ ...content, elements, files })]);
    await client.query("update website_capture_tasks set result=jsonb_set(result,'{canvasDelivery}',$2::jsonb),updated_at=now() where id=$1", [taskId, JSON.stringify(delivery)]);
    await client.query("commit");
    return delivery;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export async function finishCaptureCanvasDelivery(db: Pool, storage: StorageProvider, taskId: string): Promise<void> {
  try { await deliverCaptureToCanvas(db, storage, taskId); }
  catch (error) {
    console.error("[website-capture/canvas-delivery] delivery failed", { taskId, error });
    const delivery: Delivery = { status: "failed", elementIds: [], error: "素材已保存，但添加到画布失败。请重试添加。" };
    try {
      await db.query("update website_capture_tasks set result=jsonb_set(result,'{canvasDelivery}',$2::jsonb),updated_at=now() where id=$1 and status='succeeded' and result->'canvasDelivery'->>'status' is distinct from 'succeeded'", [taskId, JSON.stringify(delivery)]);
    } catch (markerError) {
      // The original pending receipt can be retried; losing the marker must not
      // turn a completed capture into a failed job that deletes its saved assets.
      console.error("[website-capture/canvas-delivery] pending receipt retained", { taskId, error: markerError });
    }
  }
}
