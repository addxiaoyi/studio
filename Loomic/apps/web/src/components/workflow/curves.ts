import type { SceneElement } from "./scene";

type Point = [number, number];
type Side = "left" | "right" | "top" | "bottom";
const PORT_GAP = 8;
const SAMPLES = [0, 0.04, 0.12, 0.28, 0.5, 0.72, 0.88, 0.96, 1];
const round = (value: number) => Math.round(value * 1000) / 1000;

function port(element: SceneElement, side: Side) {
  const angle = Number(element.angle) || 0;
  const normal: Point =
    side === "left"
      ? [-1, 0]
      : side === "right"
        ? [1, 0]
        : side === "top"
          ? [0, -1]
          : [0, 1];
  const offset: Point = [
    normal[0] * (element.width / 2 + PORT_GAP),
    normal[1] * (element.height / 2 + PORT_GAP),
  ];
  const rotate = ([x, y]: Point): Point => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const position = rotate(offset);
  return {
    at: [
      element.x + element.width / 2 + position[0],
      element.y + element.height / 2 + position[1],
    ] as Point,
    normal: rotate(normal),
  };
}

/** Sample the route as native arrow points so selection, binding and export still work. */
export function workflowCurve(from: SceneElement, to: SceneElement) {
  const dx = to.x + to.width / 2 - from.x - from.width / 2;
  const dy = to.y + to.height / 2 - from.y - from.height / 2;
  const horizontalGap = Math.abs(dx) - (from.width + to.width) / 2;
  const verticalGap = Math.abs(dy) - (from.height + to.height) / 2;
  const horizontal = horizontalGap >= PORT_GAP * 2;
  const vertical = !horizontal && verticalGap >= PORT_GAP * 2;
  const startSide: Side = horizontal
    ? dx >= 0
      ? "right"
      : "left"
    : vertical
      ? dy >= 0
        ? "bottom"
        : "top"
      : "right";
  const endSide: Side = horizontal
    ? dx >= 0
      ? "left"
      : "right"
    : vertical
      ? dy >= 0
        ? "top"
        : "bottom"
      : "right";
  const start = port(from, startSide),
    end = port(to, endSide);
  const gap = horizontal ? horizontalGap : verticalGap;
  const reach =
    horizontal || vertical
      ? Math.max(12, Math.min(200, (gap - PORT_GAP * 2) * 0.5))
      : Math.max(80, Math.abs(dx) + 80);
  const c1: Point = [
    start.at[0] + start.normal[0] * reach,
    start.at[1] + start.normal[1] * reach,
  ];
  const c2: Point = [
    end.at[0] + end.normal[0] * reach,
    end.at[1] + end.normal[1] * reach,
  ];
  if (!horizontal && !vertical && Math.abs(dy) < 32) {
    c1[1] -= 56;
    c2[1] += 56;
  }
  const x = round(start.at[0]),
    y = round(start.at[1]);
  const points: Point[] = SAMPLES.map((t) => {
    const u = 1 - t;
    return [
      round(
        u ** 3 * start.at[0] +
          3 * u ** 2 * t * c1[0] +
          3 * u * t ** 2 * c2[0] +
          t ** 3 * end.at[0] -
          x,
      ),
      round(
        u ** 3 * start.at[1] +
          3 * u ** 2 * t * c1[1] +
          3 * u * t ** 2 * c2[1] +
          t ** 3 * end.at[1] -
          y,
      ),
    ];
  });
  points[0] = [0, 0];
  const xs = points.map((point) => point[0]),
    ys = points.map((point) => point[1]);
  return {
    x,
    y,
    points,
    width: round(Math.max(...xs) - Math.min(...xs)),
    height: round(Math.max(...ys) - Math.min(...ys)),
    angle: 0,
    roundness: { type: 2 },
    elbowed: false,
    roughness: 0,
    strokeWidth: 1.8,
    strokeColor: "#7c879b",
    opacity: 90,
    startBinding: { elementId: from.id, focus: 0, gap: PORT_GAP },
    endBinding: { elementId: to.id, focus: 0, gap: PORT_GAP },
    startArrowhead: null,
    endArrowhead: "arrow",
  };
}

export function refreshWorkflowCurves(
  scene: readonly SceneElement[],
): readonly SceneElement[] {
  const byId = new Map(
    scene.filter((el) => !el.isDeleted).map((el) => [el.id, el]),
  );
  let changed = false;
  const refreshed = scene.map((el) => {
    if (
      el.isDeleted ||
      el.type !== "arrow" ||
      !(el.customData?.workflowEdge || el.customData?.workflowResult)
    )
      return el;
    const from = el.startBinding && byId.get(el.startBinding.elementId),
      to = el.endBinding && byId.get(el.endBinding.elementId);
    if (!from || !to) return el;
    const route = workflowCurve(from, to);
    if (
      Object.entries(route).every(
        ([key, value]) => JSON.stringify(el[key]) === JSON.stringify(value),
      )
    )
      return el;
    changed = true;
    return {
      ...el,
      ...route,
      version: (el.version ?? 1) + 1,
      versionNonce: Math.floor(Math.random() * 2_000_000_000),
      updated: Date.now(),
    };
  });
  return changed ? refreshed : scene;
}
