import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserWindow, Rectangle } from "electron";

type Placement = { bounds: Rectangle; maximized: boolean };

function validBounds(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Rectangle;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0 && bounds.height > 0;
}

export function restoreWindowPlacement(saved: unknown, displays: Rectangle[]): Placement {
  const primary = displays[0];
  if (!primary) throw new Error("No display is available for the desktop window.");
  const placement = saved as Partial<Placement> | null;
  const previous = validBounds(placement?.bounds) ? placement.bounds : null;
  const area = previous && displays.find((display) =>
    previous.x < display.x + display.width && previous.x + previous.width > display.x
    && previous.y < display.y + display.height && previous.y + previous.height > display.y,
  ) || primary;
  const width = Math.min(Math.max(previous?.width ?? 1400, 720), area.width);
  const height = Math.min(Math.max(previous?.height ?? 900, 480), area.height);
  const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, max)));
  return {
    bounds: {
      x: clamp(previous?.x ?? area.x + (area.width - width) / 2, area.x, area.x + area.width - width),
      y: clamp(previous?.y ?? area.y + (area.height - height) / 2, area.y, area.y + area.height - height),
      width: Math.round(width), height: Math.round(height),
    },
    maximized: placement?.maximized === true,
  };
}

export function readWindowPlacement(path: string, displays: Rectangle[]): Placement {
  try { return restoreWindowPlacement(JSON.parse(readFileSync(path, "utf8")), displays); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[window-placement] Cannot read saved position; using the current display.");
    return restoreWindowPlacement(null, displays);
  }
}

export function rememberWindowPlacement(window: BrowserWindow, path: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (timer) clearTimeout(timer);
    if (window.isDestroyed()) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }));
      renameSync(`${path}.tmp`, path);
    } catch { console.warn("[window-placement] Cannot save the window position."); }
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(save, 400); };
  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", save);
  window.on("closed", () => { if (timer) clearTimeout(timer); });
}
