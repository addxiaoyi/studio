export function canvasFocusTargets<T extends { id: string; isDeleted?: boolean }>(elements: readonly T[], params: Pick<URLSearchParams, "get">): T[] {
  const visible = elements.filter(element => !element.isDeleted);
  if (params.get("fitContent") === "1") return visible;
  const ids = new Set((params.get("focusElements") ?? "").split(",").slice(0, 20));
  return visible.filter(element => ids.has(element.id));
}
