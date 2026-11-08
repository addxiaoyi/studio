import { expect, it, vi } from "vitest";
import { finishCaptureCanvasDelivery } from "./canvas-delivery.js";

it("preserves a completed recording when both delivery and its failure marker lose database access", async () => {
  const db = { connect: vi.fn().mockRejectedValue(new Error("Connection lost")), query: vi.fn().mockRejectedValue(new Error("Still unavailable")) };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(finishCaptureCanvasDelivery(db as never, {} as never, "task-one")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(db.query.mock.calls[0]?.[0])).toContain("canvasDelivery");
  } finally { log.mockRestore(); }
});
