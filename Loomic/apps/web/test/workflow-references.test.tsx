import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSceneContext } from "@/components/workflow/use-scene-context";
import type {
  WorkflowCanvasApi,
  SceneElement,
} from "@/components/workflow/scene";
afterEach(cleanup);
it("offers only explicitly selected saved text and media for AI references", () => {
  let selected: Record<string, boolean> = {};
  let change: () => void = () => {};
  const elements: SceneElement[] = [
    {
      id: "text",
      type: "text",
      text: "我的创作方向",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    },
    {
      id: "image",
      type: "image",
      x: 100,
      y: 0,
      width: 100,
      height: 100,
      customData: {
        assetId: "11111111-1111-4111-8111-111111111111",
        title: "产品图",
      },
    },
    { id: "local", type: "image", x: 200, y: 0, width: 100, height: 100 },
  ];
  const unsubscribe = vi.fn();
  const api = {
    getSceneElements: () => elements,
    getAppState: () => ({ selectedElementIds: selected }),
    onChange: (listener: () => void) => {
      change = listener;
      return unsubscribe;
    },
  } as unknown as WorkflowCanvasApi;
  const hook = renderHook(() => useSceneContext(api, "workflow"));
  expect(hook.result.current.references).toEqual([]);
  act(() => {
    selected = { text: true, image: true, local: true };
    change();
  });
  expect(hook.result.current.references.map((item) => item.id)).toEqual([
    "text",
    "image",
  ]);
  act(() => {
    selected = {};
    change();
  });
  expect(hook.result.current.references).toEqual([]);
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
