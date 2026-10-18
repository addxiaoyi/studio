/**
 * Canvas element normalization pipeline.
 *
 * Runs after loading canvas content from DB to fix measurement inaccuracies
 * from server-side element creation. Uses browser DOM canvas for accurate
 * text measurement, matching Excalidraw's internal rendering.
 */

type CanvasElement = Record<string, unknown>;

/** Keep persisted agent-created elements compatible with Excalidraw's hit testing. */
export function normalizeCanvasElement(element: CanvasElement): CanvasElement {
  const normalized = { ...element };
  if (!Array.isArray(normalized.groupIds)) normalized.groupIds = [];
  if ((normalized.type === "line" || normalized.type === "arrow" || normalized.type === "freedraw") && !Array.isArray(normalized.points)) {
    normalized.points = [[0, 0], [Number(normalized.width) || 0, Number(normalized.height) || 0]];
  }
  if (!Array.isArray(normalized.boundElements)) normalized.boundElements = null;
  if (normalized.frameId === undefined) normalized.frameId = null;
  if (normalized.roundness === undefined) normalized.roundness = null;
  if (normalized.link === undefined) normalized.link = null;
  if (normalized.locked === undefined) normalized.locked = false;
  if (normalized.opacity === undefined) normalized.opacity = 100;
  if (normalized.angle === undefined) normalized.angle = 0;
  if (normalized.scale === undefined) normalized.scale = [1, 1];
  if (normalized.status === undefined) normalized.status = "saved";
  return normalized;
}

const EXCALIDRAW_FONT_FAMILY_MAP: Record<number, string> = {
  1: "20px Virgil, Segoe Print, Comic Sans MS, cursive",
  2: "20px Helvetica, Arial, sans-serif",
  3: "20px Cascadia, monospace",
};

function measureTextDOM(
  text: string,
  fontSize: number,
  fontFamily: number = 1,
): { width: number; height: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { width: text.length * fontSize * 0.6, height: fontSize * 1.25 };
  }
  const baseFontStr = EXCALIDRAW_FONT_FAMILY_MAP[fontFamily] ?? EXCALIDRAW_FONT_FAMILY_MAP[1]!;
  const fontStr = baseFontStr.replace("20px", `${fontSize}px`);
  ctx.font = fontStr;
  const lines = text.split("\n");
  const lineHeight = fontSize * 1.25;
  let maxWidth = 0;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxWidth) maxWidth = metrics.width;
  }
  return { width: maxWidth, height: lines.length * lineHeight };
}

function validateBindings(elements: CanvasElement[]): boolean {
  const activeIds = new Set(
    elements.filter((el) => !el.isDeleted).map((el) => el.id as string),
  );
  let changed = false;
  for (const el of elements) {
    if (el.isDeleted) continue;
    if (Array.isArray(el.boundElements)) {
      const before = (el.boundElements as unknown[]).length;
      el.boundElements = (
        el.boundElements as Array<{ id: string; type: string }>
      ).filter((b) => b?.id && activeIds.has(b.id));
      if ((el.boundElements as unknown[]).length !== before) changed = true;
    }
    if (el.containerId && !activeIds.has(el.containerId as string)) {
      el.containerId = null;
      changed = true;
    }
    if (el.startBinding) {
      const binding = el.startBinding as { elementId: string };
      if (!activeIds.has(binding.elementId)) { el.startBinding = null; changed = true; }
    }
    if (el.endBinding) {
      const binding = el.endBinding as { elementId: string };
      if (!activeIds.has(binding.elementId)) { el.endBinding = null; changed = true; }
    }
  }
  return changed;
}

function recenterBoundTextElements(elements: CanvasElement[]): boolean {
  const elementMap = new Map(elements.map((el) => [el.id as string, el]));
  let changed = false;
  const TOLERANCE = 0.05;

  for (const el of elements) {
    if (el.isDeleted) continue;
    if (el.type !== "text" || !el.containerId) continue;
    const container = elementMap.get(el.containerId as string);
    if (!container || container.isDeleted) continue;
    const text = el.text as string;
    if (!text) continue;
    const fontSize = (el.fontSize as number) || 20;
    const fontFamily = (el.fontFamily as number) || 1;
    const measured = measureTextDOM(text, fontSize, fontFamily);
    const currentW = Number(el.width) || 0;
    const currentH = Number(el.height) || 0;
    const wDiff = Math.abs(measured.width - currentW) / Math.max(currentW, 1);
    const hDiff = Math.abs(measured.height - currentH) / Math.max(currentH, 1);
    if (wDiff > TOLERANCE || hDiff > TOLERANCE) {
      el.width = measured.width;
      el.height = measured.height;
      changed = true;
    }
    const paddingX = Math.max(fontSize * 1.5, 30);
    const paddingY = Math.max(fontSize * 1.2, 24);
    const minContainerW = measured.width + paddingX * 2;
    const minContainerH = measured.height + paddingY * 2;
    const containerW = Number(container.width) || 0;
    const containerH = Number(container.height) || 0;
    if (containerW < minContainerW) { container.width = minContainerW; changed = true; }
    if (containerH < minContainerH) { container.height = minContainerH; changed = true; }
    const finalContainerW = Number(container.width);
    const finalContainerH = Number(container.height);
    const finalTextW = Number(el.width);
    const finalTextH = Number(el.height);
    const expectedX = Number(container.x) + (finalContainerW - finalTextW) / 2;
    const expectedY = Number(container.y) + (finalContainerH - finalTextH) / 2;
    const currentX = Number(el.x) || 0;
    const currentY = Number(el.y) || 0;
    if (Math.abs(expectedX - currentX) > 2 || Math.abs(expectedY - currentY) > 2) {
      el.x = expectedX;
      el.y = expectedY;
      changed = true;
    }
  }
  return changed;
}

export function normalizeCanvasElements(
  elements: CanvasElement[],
): { elements: CanvasElement[]; changed: boolean } {
  let changed = false;
  for (let index = 0; index < elements.length; index += 1) {
    const current = elements[index]!;
    const normalized = normalizeCanvasElement(current);
    if (JSON.stringify(normalized) !== JSON.stringify(current)) {
      elements[index] = normalized;
      changed = true;
    }
  }
  if (validateBindings(elements)) changed = true;
  if (recenterBoundTextElements(elements)) changed = true;
  return { elements, changed };
}
