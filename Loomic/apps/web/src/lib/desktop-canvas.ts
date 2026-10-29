const CANVAS_KEY_PREFIX = "helstera.desktop.last-canvas.";
const CANVAS_ROUTE = "/desktop-app/canvas";

function canvasStorageKey(userId: string) {
  return CANVAS_KEY_PREFIX + userId;
}

export function getLastDesktopCanvasId(userId: string | null | undefined) {
  if (!userId || typeof window === "undefined") return null;
  return window.localStorage.getItem(canvasStorageKey(userId));
}

export function rememberDesktopCanvas(userId: string | null | undefined, canvasId: string) {
  if (!userId || typeof window === "undefined" || !canvasId.trim()) return;
  window.localStorage.setItem(canvasStorageKey(userId), canvasId);
  window.dispatchEvent(new Event("desktop:canvas-changed"));
}

export function clearLastDesktopCanvas(userId: string | null | undefined, canvasId?: string) {
  if (!userId || typeof window === "undefined") return;
  const key = canvasStorageKey(userId);
  if (canvasId && window.localStorage.getItem(key) !== canvasId) return;
  window.localStorage.removeItem(key);
  window.dispatchEvent(new Event("desktop:canvas-changed"));
}

export function desktopCanvasHref(href: string, canvasId: string | null) {
  const route = new URL(href, "https://helstera.invalid");
  if (route.pathname.replace(/\/$/, "") !== CANVAS_ROUTE || !canvasId) return href;
  route.searchParams.set("id", canvasId);
  return route.pathname + route.search + route.hash;
}
