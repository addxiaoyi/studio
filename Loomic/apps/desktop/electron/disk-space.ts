const GIB = 1024 ** 3;
export function diskWarning(available: number, capacity: number): "normal" | "low" | "critical" {
  if (available < GIB / 2) return "critical";
  return available < 5 * GIB || capacity > 0 && available / capacity < 0.05 ? "low" : "normal";
}
