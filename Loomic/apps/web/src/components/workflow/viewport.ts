import gsap from "gsap";
import type { CanvasState, WorkflowCanvasApi, SceneElement } from "./scene";
const motions = new WeakMap<WorkflowCanvasApi, gsap.core.Tween>();
export function moveCanvasView(
  api: WorkflowCanvasApi,
  next: Pick<CanvasState, "scrollX" | "scrollY" | "zoom">,
) {
  motions.get(api)?.kill();
  const initial = api.getAppState(),
    view = { x: initial.scrollX, y: initial.scrollY, z: initial.zoom.value };
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    api.updateScene({ appState: next, captureUpdate: "NEVER" });
    return;
  }
  const clear = () => {
    window.removeEventListener("pointerdown", interrupt, true);
    window.removeEventListener("wheel", interrupt, true);
  };
  const interrupt = (event: Event) => {
    if (event.target instanceof HTMLCanvasElement) {
      motions.get(api)?.kill();
      clear();
    }
  };
  const tween = gsap.to(view, {
    x: next.scrollX,
    y: next.scrollY,
    z: next.zoom.value,
    duration: reduced ? 0 : 0.3,
    ease: "power2.out",
    onUpdate: () =>
      api.updateScene({
        appState: { scrollX: view.x, scrollY: view.y, zoom: { value: view.z } },
        captureUpdate: "NEVER",
      }),
    onComplete: clear,
    onInterrupt: clear,
  });
  motions.set(api, tween);
  window.addEventListener("pointerdown", interrupt, true);
  window.addEventListener("wheel", interrupt, true);
}
export function stopCanvasView(api: WorkflowCanvasApi) {
  motions.get(api)?.kill();
  motions.delete(api);
}
export function focusCanvasContent(
  api: WorkflowCanvasApi,
  targets: readonly SceneElement[],
  open: boolean,
) {
  if (!targets.length) return;
  const state = api.getAppState(),
    narrow = state.width <= 760;
  const left = Math.min(...targets.map((el) => el.x)),
    top = Math.min(...targets.map((el) => el.y));
  const width = Math.max(...targets.map((el) => el.x + el.width)) - left,
    height = Math.max(...targets.map((el) => el.y + el.height)) - top;
  const panelWidth =
    open && !narrow ? Math.min(340, state.width * 0.42) + 16 : 0;
  const availableWidth = Math.max(150, state.width - 140 - panelWidth),
    availableHeight = Math.max(
      150,
      state.height * (open && narrow ? 0.42 : 0.8) - 80,
    );
  const zoom = Math.max(
    0.1,
    Math.min(
      1,
      availableWidth / Math.max(width, 1),
      availableHeight / Math.max(height, 1),
    ),
  );
  moveCanvasView(api, {
    zoom: { value: zoom },
    scrollX:
      (85 + panelWidth + (availableWidth - width * zoom) / 2) / zoom - left,
    scrollY: (100 + (availableHeight - height * zoom) / 2) / zoom - top,
  });
}
