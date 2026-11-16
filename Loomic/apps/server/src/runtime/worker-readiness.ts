import type { Pool } from "pg";
import type { CapacityPolicy } from "../config/capacity-policy.js";
import { probeWritableStorage } from "./storage-probe.js";

export async function assertWorkerDependencies(
  database: Pick<Pool, "query">,
  storageRoot: string,
  capacityPolicy?: CapacityPolicy,
): Promise<void> {
  await database.query("select 1");
  await probeWritableStorage(storageRoot, capacityPolicy);
}
