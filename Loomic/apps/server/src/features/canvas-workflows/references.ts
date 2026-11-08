import type { Pool } from "pg";
import { assertWorkflowCanvas, WorkflowError } from "./service.js";
import { readWorkflowMaterial } from "./materials.js";

export async function workflowReferences(
  db: Pool,
  userId: string,
  canvasId: string,
  elementIds: string[],
) {
  const workspace = await assertWorkflowCanvas(db, userId, canvasId);
  const row = (
    await db.query("select content from canvases where id=$1", [canvasId])
  ).rows[0];
  const elements = (row?.content?.elements ?? []) as Array<{
    id: string;
    type: string;
    text?: string;
    isDeleted?: boolean;
    customData?: Record<string, unknown>;
  }>;
  const references = [];
  for (const id of new Set(elementIds)) {
    const element = elements.find((item) => item.id === id && !item.isDeleted);
    if (!element)
      throw new WorkflowError("引用的画布内容已删除，请重新选择。", 409);
    if (element.type === "text" && typeof element.text === "string")
      references.push({
        elementId: id,
        kind: "text",
        title: element.text.slice(0, 60),
        text: element.text.slice(0, 2500),
      });
    else if (
      typeof element.customData?.assetId === "string" &&
      (element.type === "image" || element.customData.isVideo === true)
    ) {
      const mediaType = element.type === "image" ? "image" : "video";
      const asset = await readWorkflowMaterial(db, {
        canvasId,
        workspaceId: workspace,
        userId,
        elementId: id,
        assetId: element.customData.assetId,
        mediaType,
      });
      references.push({
        elementId: id,
        kind: "asset",
        assetId: asset.id,
        mediaType,
        title: String(
          element.customData.title ??
            (mediaType === "image" ? "画布图片" : "画布视频"),
        ).slice(0, 100),
      });
    } else throw new WorkflowError("仅支持引用画布文字及已保存的图片、视频。");
  }
  return references;
}
