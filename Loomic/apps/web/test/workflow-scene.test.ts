import { describe, expect, it } from "vitest";
import { websiteWorkflow } from "@helstera/shared";
import {
  projectWorkflow,
  readSceneWorkflow,
  nodeElementId,
  adoptWorkflowCopies,
  retainWorkflowLayout,
  placeWorkflow,
  type SceneElement,
} from "@/components/workflow/scene";

const note: SceneElement = {
  id: "note",
  type: "text",
  x: 10,
  y: 20,
  width: 100,
  height: 30,
  text: "普通画布备注",
};
describe("workflows on the existing canvas", () => {
  it("preserves spacing beside a large existing canvas", () => {
    const graph=websiteWorkflow();
    const placed=placeWorkflow(graph,[{...note,x:20000}],{scrollX:0,scrollY:0,width:1000,height:800,zoom:{value:1},selectedElementIds:{}});
    expect(placed.nodes[1]!.position.x-placed.nodes[0]!.position.x).toBe(390);
    expect(placed.nodes[0]!.position.x).toBeGreaterThan(20000);
  });
  it("keeps AI revisions beside existing work instead of resetting nodes to the canvas origin", () => {
    const before = websiteWorkflow();
    before.nodes = before.nodes.map(node => ({ ...node, position: { x: node.position.x + 2000, y: 700 } }));
    const proposed = websiteWorkflow();
    proposed.nodes[1]!.title = "更新后的截图步骤";
    proposed.nodes.push({ id: "extra", title: "另一个网址", position: { x: 0, y: 250 }, config: { kind: "url", url: "https://example.com/" } });
    const revised = retainWorkflowLayout(proposed, before);
    expect(revised.nodes[1]!.position).toEqual(before.nodes[1]!.position);
    expect(revised.nodes[3]!.position).toEqual({ x: 2000, y: 950 });
  });
  it("gives native copies independent node identities and reconnects copied arrows", () => {
    const graph = websiteWorkflow(),
      scene = projectWorkflow([note], "flow", graph, {}, false);
    const source = scene.find(
      (el) => el.id === nodeElementId("flow", graph.nodes[0]!),
    )!;
    const copy = { ...source, id: "native-copy", x: 600, y: 300 };
    const arrow = {
      ...note,
      id: "copy-arrow",
      type: "arrow",
      startBinding: { elementId: copy.id },
      endBinding: { elementId: nodeElementId("flow", graph.nodes[1]!) },
    };
    const adopted = adoptWorkflowCopies([...scene, copy, arrow], "flow");
    const cloned = adopted.find((el) => el.x === 600 && el.y === 300)!;
    expect(cloned.id).not.toBe(source.id);
    expect(
      adopted.find((el) => el.id === "copy-arrow")?.startBinding?.elementId,
    ).toBe(cloned.id);
    expect(readSceneWorkflow(adopted, "flow", graph).graph.nodes).toHaveLength(
      4,
    );
    expect(adoptWorkflowCopies(adopted, "flow")).toEqual(adopted);
  });
  it("adds native nodes without replacing drawings, and keeps projection idempotent", () => {
    const graph = websiteWorkflow();
    const first = projectWorkflow([note], "flow", graph, {}, false);
    expect(first[0]).toBe(note);
    expect(first.filter((el) => el.type === "embeddable")).toHaveLength(3);
    expect(first.filter((el) => el.type === "arrow")).toHaveLength(2);
    expect(projectWorkflow(first, "flow", graph, {}, false)).toEqual(first);
  });
  it("reads native dragging, deletion and undo without touching ordinary elements", () => {
    const graph = websiteWorkflow();
    const scene = projectWorkflow([note], "flow", graph, {}, false);
    const moved = scene.map((el) =>
      el.id === nodeElementId("flow", graph.nodes[0]!)
        ? { ...el, x: 520, y: 42 }
        : el,
    );
    expect(
      readSceneWorkflow(moved, "flow", graph).graph.nodes[0]!.position,
    ).toEqual({ x: 520, y: 42 });
    const removed = moved.map((el) =>
      el.id === nodeElementId("flow", graph.nodes[1]!)
        ? { ...el, isDeleted: true }
        : el,
    );
    const after = readSceneWorkflow(removed, "flow", graph).graph;
    expect(after.nodes).toHaveLength(2);
    expect(after.edges).toHaveLength(0);
    expect(readSceneWorkflow(scene, "flow", after).graph.nodes).toHaveLength(3);
  });
  it("turns an arrow from an existing video into a typed material connection", () => {
    const graph = websiteWorkflow();
    graph.nodes[1]!.config = {
      kind: "trim",
      start: 0,
      end: 3,
      aspect: "original",
    };
    graph.nodes = graph.nodes.slice(1);
    graph.edges = graph.edges.slice(1);
    const video: SceneElement = {
      ...note,
      id: "video",
      type: "embeddable",
      customData: {
        isVideo: true,
        assetId: "ea5aa1ab-10b3-4f12-b89a-963b26b47b86",
      },
    };
    const scene = projectWorkflow([note, video], "flow", graph, {}, false);
    scene.push({
      ...note,
      id: "user-arrow",
      type: "arrow",
      startBinding: { elementId: "video" },
      endBinding: { elementId: nodeElementId("flow", graph.nodes[0]!) },
    });
    const imported = readSceneWorkflow(scene, "flow", graph);
    expect(
      imported.graph.nodes.find((node) => node.config.kind === "asset")?.config,
    ).toMatchObject({ elementId: "video", mediaType: "video" });
    expect(imported.graph.edges).toHaveLength(2);
    expect(imported.issues).toEqual([]);
    const projected = projectWorkflow(scene, "flow", imported.graph, {}, false);
    expect(projected.find((el) => el.id === "video")?.type).toBe("embeddable");
    expect(projected.filter((el) => el.id === "note")).toEqual([note]);
  });
  it("keeps invalid arrows out of executable graphs", () => {
    const graph = websiteWorkflow();
    const scene = projectWorkflow([note], "flow", graph, {}, false);
    scene.push({
      ...note,
      id: "bad-arrow",
      type: "arrow",
      startBinding: { elementId: nodeElementId("flow", graph.nodes[2]!) },
      endBinding: { elementId: nodeElementId("flow", graph.nodes[0]!) },
    });
    const checked = readSceneWorkflow(scene, "flow", graph);
    expect(checked.issues).toHaveLength(1);
    expect(checked.graph.edges).toHaveLength(2);
  });
});
