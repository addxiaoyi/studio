import { describe, expect, it } from "vitest";
import { websiteWorkflow } from "@helstera/shared";
import {
  workflowCurve,
  refreshWorkflowCurves,
} from "@/components/workflow/curves";
import {
  projectWorkflow,
  linkWorkflowResults,
  type SceneElement,
} from "@/components/workflow/scene";

const box = (id: string, x: number, y: number): SceneElement => ({
  id,
  type: "embeddable",
  x,
  y,
  width: 300,
  height: 180,
  angle: 0,
});
const pointAt = (line: ReturnType<typeof workflowCurve>, index: number) => {
  const point = line.points.at(index)!;
  return [line.x + point[0], line.y + point[1]];
};
describe("workflow curved connections", () => {
  it("leaves horizontal node edges tangentially and bends through the gap", () => {
    const line = workflowCurve(box("a", 0, 0), box("b", 500, 200));
    expect(line.points.length).toBeGreaterThan(4);
    expect(pointAt(line, 0)).toEqual([308, 90]);
    expect(pointAt(line, -1)).toEqual([492, 290]);
    const first = line.points[1]!;
    expect(Math.abs(first[1] / first[0])).toBeLessThan(0.4);
    expect(line.points.slice(1, -1).every(([x]) => x > 0 && x < 184)).toBe(
      true,
    );
  });
  it("uses facing edges for reversed and stacked nodes instead of crossing their bodies", () => {
    const backwards = workflowCurve(box("a", 500, 0), box("b", 0, 200));
    expect(pointAt(backwards, 0)).toEqual([492, 90]);
    expect(pointAt(backwards, -1)).toEqual([308, 290]);
    const stacked = workflowCurve(box("a", 0, 0), box("b", 80, 400));
    expect(pointAt(stacked, 0)).toEqual([150, 188]);
    expect(pointAt(stacked, -1)).toEqual([230, 392]);
    expect(stacked.width).toBeGreaterThan(0);
    expect(stacked.height).toBeGreaterThan(0);
  });
  it("keeps coincident and rotated nodes finite, with accurate point bounds", () => {
    for (const target of [
      box("b", 0, 0),
      { ...box("b", 500, 100), angle: Math.PI / 4 },
      box("b", 300.01, 2),
    ]) {
      const line = workflowCurve(box("a", 0, 0), target);
      const xs = line.points.map((point) => point[0]),
        ys = line.points.map((point) => point[1]);
      expect(
        [...xs, ...ys, line.x, line.y, line.width, line.height].every(
          Number.isFinite,
        ),
      ).toBe(true);
      expect(line.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 4);
      expect(line.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 4);
      expect(line.points[0]).toEqual([0, 0]);
    }
  });
  it("refreshes old and result connections while preserving ordinary arrows, deletion and identities", () => {
    const graph = websiteWorkflow();
    graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
    graph.nodes[1]!.position.y = 200;
    const note = box("result", 1300, 250);
    const ordinary: SceneElement = {
      ...box("ordinary", 0, 0),
      type: "arrow",
      points: [
        [0, 0],
        [20, 40],
      ],
    };
    const scene = linkWorkflowResults(
      projectWorkflow([note, ordinary], "flow", graph, {}, false),
      "flow",
      graph,
      "goal",
      [note.id],
    );
    expect(scene.find((el) => el.id.startsWith("we:"))!.points).toHaveLength(9);
    expect(scene.find((el) => el.id.startsWith("wr:"))!.roundness).toEqual({
      type: 2,
    });
    const moved = scene.map((el) =>
      el.id === "wf:flow:capture" ? { ...el, x: el.x + 90, y: el.y + 70 } : el,
    );
    const before = moved.find((el) => el.id === "we:flow:e-1")!;
    const refreshed = refreshWorkflowCurves(moved);
    const after = refreshed.find((el) => el.id === before.id)!;
    expect(after.points).not.toEqual(before.points);
    expect(after.endBinding?.elementId).toBe("wf:flow:capture");
    expect(refreshed.find((el) => el.id === ordinary.id)).toBe(ordinary);
    expect(refreshWorkflowCurves(refreshed)).toBe(refreshed);
    expect(
      refreshWorkflowCurves(
        refreshed.map((el) =>
          el.id === before.id ? { ...el, isDeleted: true } : el,
        ),
      ).find((el) => el.id === before.id)!.isDeleted,
    ).toBe(true);
  });
});
