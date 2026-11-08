import type { Pool } from "pg";
import { createElementBase } from "../../agent/tools/canvas-element-helpers.js";
import { calculateAutoPlacement } from "../canvas/canvas-element-writer.js";
import { workflowDocumentElement } from "@helstera/shared";

export async function writeWorkflowText(
  db: Pool,
  canvasId: string,
  stepId: string,
  title: string,
  text: string,
) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const row = (
      await client.query(
        "select content from canvases where id=$1 for update",
        [canvasId],
      )
    ).rows[0];
    if (!row) throw new Error("画布不可用。");
    const content = row.content ?? {},
      elements = (content.elements ?? []) as Array<Record<string, unknown>>;
    const jobId = `workflow-text:${stepId}`,
      prior = elements.find(
        (el) => (el.customData as { jobId?: string })?.jobId === jobId,
      );
    if (prior) {
      await client.query("commit");
      return String(prior.id);
    }
    const wrapped = [
      title,
      "",
      ...text.split("\n").flatMap((line) => line.match(/.{1,38}/gu) ?? [""]),
    ].join("\n");
    const height = Math.max(60, wrapped.split("\n").length * 22.5),
      placement = calculateAutoPlacement(
        elements,
        760,
        height,
        Math.max(760, height),
      );
    const element = workflowDocumentElement({
      ...createElementBase(),
      type: "text",
      ...placement,
      fontSize: 18,
      fontFamily: 2,
      lineHeight: 1.25,
      text: wrapped,
      originalText: wrapped,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: false,
      customData: { jobId, title, source: "workflow",workflowDocument:{title,markdown:text} },
    });
    await client.query(
      "update canvases set content=$2::jsonb,updated_at=now() where id=$1",
      [
        canvasId,
        JSON.stringify({ ...content, elements: [...elements, element] }),
      ],
    );
    await client.query("commit");
    return String((element as Record<string, unknown>).id);
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}
