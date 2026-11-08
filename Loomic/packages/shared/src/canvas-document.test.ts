import { expect, it } from "vitest";
import { workflowDocumentElement } from "./canvas-document.js";
it("upgrades old workflow Markdown text without changing identity, position or source", () => {
  const legacy = {
    id: "document",
    type: "text",
    x: 40,
    y: 50,
    width: 760,
    height: 900,
    text: "生成分镜\n\n# 片名\n\n## 镜头一\n**动作**：奔跑",
    customData: {
      jobId: "workflow-text:step",
      title: "生成分镜",
      source: "workflow",
    },
  };
  const upgraded = workflowDocumentElement(legacy);
  expect(upgraded).toMatchObject({
    id: "document",
    type: "embeddable",
    x: 40,
    y: 50,
    customData: {
      workflowDocument: {
        markdown: "# 片名\n\n## 镜头一\n**动作**：奔跑",
        title: "生成分镜",
      },
    },
  });
  expect(workflowDocumentElement(upgraded)).toEqual(upgraded);
  expect(legacy.type).toBe("text");
});
it("leaves ordinary notes, subtitles and user Markdown intact", () => {
  for (const element of [
    { id: "note", type: "text", text: "# 我写的备注" },
    {
      id: "caption",
      type: "text",
      text: "**字幕**",
      customData: { isSubtitle: true },
    },
  ])
    expect(workflowDocumentElement(element)).toBe(element);
});
