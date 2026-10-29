import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLastDesktopCanvas,
  desktopCanvasHref,
  getLastDesktopCanvasId,
  rememberDesktopCanvas,
} from "@/lib/desktop-canvas";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("desktop canvas recovery", () => {
  it("remembers the active canvas separately for each account", () => {
    rememberDesktopCanvas("user-a", "canvas-a");
    rememberDesktopCanvas("user-b", "canvas-b");
    expect(getLastDesktopCanvasId("user-a")).toBe("canvas-a");
    expect(getLastDesktopCanvasId("user-b")).toBe("canvas-b");
  });

  it("does not clear a newer canvas when an older canvas fails to load", () => {
    rememberDesktopCanvas("user-a", "canvas-new");
    clearLastDesktopCanvas("user-a", "canvas-old");
    expect(getLastDesktopCanvasId("user-a")).toBe("canvas-new");
  });

  it("adds the last canvas id only to the desktop canvas route", () => {
    expect(desktopCanvasHref("/desktop-app/canvas/", "canvas-a")).toBe(
      "/desktop-app/canvas/?id=canvas-a",
    );
    expect(desktopCanvasHref("/desktop-app/projects/", "canvas-a")).toBe(
      "/desktop-app/projects/",
    );
  });
});
