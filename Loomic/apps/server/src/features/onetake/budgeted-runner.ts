import { stat } from "node:fs/promises";
import type { Pool } from "pg";
import { withMediaBudget } from "../../runtime/media-admission.js";
import { runOneTake } from "./runner.js";

export function budgetedMediaRunner(db: Pool, storageRoot: string) {
  return async (input: Record<string, unknown>, signal?: AbortSignal) => {
    const paths = typeof input.source === "string" ? [input.source] : Array.isArray(input.sources) ? input.sources : [];
    let sourceBytes = 0;
    for (const path of paths) {
      if (typeof path !== "string") throw new Error("Media source path is invalid");
      sourceBytes += (await stat(path)).size;
    }
    return withMediaBudget({
      db, storageRoot, kind: "transcode",
      reserveBytes: Math.max(1024 ** 3, sourceBytes * 3 + 256 * 1024 ** 2),
      ...(signal ? { signal } : {}),
    }, budget => runOneTake(input, budget.signal, budget.scratchRoot));
  };
}
