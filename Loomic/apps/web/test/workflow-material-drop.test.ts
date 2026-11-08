import { describe, expect, it } from "vitest";
import { compileWorkflow, type WorkflowGraph } from "@helstera/shared";
import {
  embedWorkflowMaterials,
  removeWorkflowReference,
  workflowInputReferences,
} from "@/components/workflow/material-inputs";
import {
  projectWorkflow,
  type SceneElement,
} from "@/components/workflow/scene";

const asset = "f6eec59d-3554-4d5d-a85f-06cdc51c2b56";
const image: SceneElement = {
  id: "photo",
  type: "image",
  x: 40,
  y: 50,
  width: 160,
  height: 100,
  customData: { assetId: asset, title: "角色照片" },
};
const video: SceneElement = {
  ...image,
  id: "recording",
  type: "embeddable",
  customData: {
    assetId: "2e7e414e-e90a-4350-babc-508a937305ea",
    isVideo: true,
    title: "网站录像",
  },
};
const graph = (): WorkflowGraph => ({
  title: "参考生成",
  nodes: [
    {
      id: "generate",
      title: "参考图创作",
      position: { x: 500, y: 80 },
      config: {
        kind: "generate",
        mediaType: "image",
        model: "image-model",
        prompt: "保留角色",
        aspectRatio: "16:9",
        duration: 5,
        resolution: "720p",
      },
    },
    {
      id: "deliver",
      title: "回到画布",
      position: { x: 900, y: 80 },
      config: { kind: "deliver" },
    },
  ],
  edges: [{ id: "output", source: "generate", target: "deliver" }],
});

describe("embedding canvas media into workflow inputs", () => {
  it("connects the original image once, preserves the canvas and compiles the real reference", () => {
    const before = graph();
    const embedded = embedWorkflowMaterials(before, [image], "generate");
    const input = embedded.nodes.find((node) => node.config.kind === "asset")!;
    expect(input.config).toMatchObject({
      elementId: image.id,
      assetId: asset,
      mediaType: "image",
    });
    expect(input.position).toEqual({ x: 40, y: 50 });
    expect(
      compileWorkflow(embedded).steps.find((step) => step.id === "generate")!
        .command,
    ).toMatchObject({ executor: "media.generate", sources: [input.id] });
    expect(embedWorkflowMaterials(embedded, [image], "generate")).toEqual(
      embedded,
    );
    expect(
      projectWorkflow([image], "flow", embedded, {}, false).find(
        (el) => el.id === image.id,
      ),
    ).toMatchObject({ type: "image", x: 40, y: 50 });
    expect(before.nodes).toHaveLength(2);
  });
  it("turns video into an explicit configurable frame step before paid generation", () => {
    const embedded = embedWorkflowMaterials(graph(), [video], "generate");
    const frame = embedded.nodes.find((node) => node.config.kind === "frame")!;
    expect(frame.config).toEqual({ kind: "frame", at: 0 });
    const plan = compileWorkflow(embedded);
    expect(plan.steps.map((step) => step.command.executor)).toEqual([
      "canvas.asset",
      "media.frame",
      "media.generate",
      "result.deliver",
    ]);
    expect(workflowInputReferences(embedded, "generate")).toMatchObject([
      {
        sourceId: frame.id,
        mediaType: "video",
        assetId: video.customData!.assetId,
        frameAt: 0,
      },
    ]);
    expect(embedWorkflowMaterials(embedded, [video], "generate")).toEqual(
      embedded,
    );
    const removed = removeWorkflowReference(embedded, "generate", frame.id);
    expect(removed).toEqual(graph());
  });
  it("rejects unpersisted images, invalid targets and a seventh reference atomically", () => {
    expect(() =>
      embedWorkflowMaterials(
        graph(),
        [{ ...image, customData: {} }],
        "generate",
      ),
    ).toThrow("上传");
    expect(() => embedWorkflowMaterials(graph(), [image], "missing")).toThrow(
      "节点",
    );
    const sources = Array.from({ length: 7 }, (_, index) => ({
      ...image,
      id: `image-${index}`,
      customData: { assetId: `f6eec59d-3554-4d5d-a85f-06cdc51c2b5${index}` },
    }));
    const before = graph();
    expect(() => embedWorkflowMaterials(before, sources, "generate")).toThrow(
      "6",
    );
    expect(before.nodes).toHaveLength(2);
  });
  it("keeps shared inputs and exposes thumbnails inside projected nodes", () => {
    const embedded = embedWorkflowMaterials(graph(), [image], "generate");
    const input = embedded.nodes.find((node) => node.config.kind === "asset")!;
    embedded.edges.push({
      id: "also-deliver",
      source: input.id,
      target: "deliver",
    });
    const scene = projectWorkflow([image], "flow", embedded, {}, false);
    expect(() => embedWorkflowMaterials(graph(), [scene.find(el => el.id === image.id)!], "generate")).toThrow("其他流程");
    expect(
      (
        scene.find((el) => el.id === "wf:flow:generate")!.customData!
          .workflow as { references: unknown }
      ).references,
    ).toMatchObject([{ assetId: asset, mediaType: "image" }]);
    expect(
      removeWorkflowReference(embedded, "generate", input.id).nodes,
    ).toContainEqual(input);
  });
});
