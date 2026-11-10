import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat, statfs } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";

const MIB = 1024 ** 2;
const DISK_FLOOR = 512 * MIB;
const LEASE_SECONDS = 45;
const HEARTBEAT_MS = 10_000;

export class MediaCapacityError extends Error {
  readonly code: string;
  constructor(code: "media_capacity_busy" | "media_disk_full", message: string) {
    super(message);
    this.name = "MediaCapacityError";
    this.code = code;
  }
}

type BudgetRequest = {
  db: Pool;
  storageRoot: string;
  kind: "capture" | "transcode";
  reserveBytes: number;
  signal?: AbortSignal;
};
export type MediaBudget = { scratchRoot: string; signal: AbortSignal; release(): Promise<void> };

export async function withMediaBudget<T>(request: BudgetRequest, work: (budget: Awaited<ReturnType<typeof acquireMediaBudget>>) => Promise<T>, onWaiting?: () => Promise<void>) {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    request.signal?.throwIfAborted();
    let budget: Awaited<ReturnType<typeof acquireMediaBudget>>;
    try { budget = await acquireMediaBudget(request); }
    catch (error) {
      if (!(error instanceof MediaCapacityError) || error.code !== "media_capacity_busy" || Date.now() >= deadline) throw error;
      await onWaiting?.();
      await delay(2000, undefined, request.signal ? { signal: request.signal } : {});
      continue;
    }
    try {
      const output = await work(budget);
      budget.signal.throwIfAborted();
      return output;
    }
    finally { await budget.release(); }
  }
}

export async function acquireMediaBudget(request: BudgetRequest): Promise<MediaBudget> {
  request.signal?.throwIfAborted();
  if (!Number.isSafeInteger(request.reserveBytes) || request.reserveBytes < MIB || request.reserveBytes > 32 * 1024 * MIB) {
    throw new Error("Invalid media scratch reservation");
  }
  const root = await realpath(request.storageRoot);
  const scratch = join(root, ".media-tmp");
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  if (await realpath(scratch) !== scratch) throw new Error("Media temporary directory must not be a symlink");
  const diskKey = `${hostname()}:${(await stat(scratch)).dev}`;
  const id = randomUUID();
  let leaseStartedAt = Date.now();
  const client = await request.db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`media-budget:${diskKey}`]);
    await client.query("delete from media_resource_leases where disk_key=$1 and lease_until<=now()", [diskKey]);
    const { rows } = await client.query<{ count: string; bytes: string }>(
      "select count(*) as count,coalesce(sum(reserved_bytes),0) as bytes from media_resource_leases where disk_key=$1 and lease_until>now()", [diskKey],
    );
    // One heavy media operation per disk/host bounds both CPU and scratch usage.
    if (Number(rows[0]?.count ?? 0) >= 1) throw new MediaCapacityError("media_capacity_busy", "另一项媒体任务正在处理，请稍后继续；本次尚未开始录制或转码。");
    const space = await statfs(scratch, { bigint: true });
    const needed = BigInt(rows[0]?.bytes ?? "0") + BigInt(request.reserveBytes + DISK_FLOOR);
    if (space.bavail * space.bsize < needed) throw new MediaCapacityError("media_disk_full", "媒体处理空间不足，请释放空间后重试；原素材仍保留。");
    request.signal?.throwIfAborted();
    leaseStartedAt = Date.now();
    await client.query("insert into media_resource_leases(id,disk_key,kind,reserved_bytes,lease_until) values($1,$2,$3,$4,now()+make_interval(secs=>$5))", [id, diskKey, request.kind, request.reserveBytes, LEASE_SECONDS]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }

  const controller = new AbortController();
  const relay = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", relay, { once: true });
  if (request.signal?.aborted) relay();
  const remainingLease = () => Math.max(0, LEASE_SECONDS * 1000 - (Date.now() - leaseStartedAt));
  let watchdog = setTimeout(() => controller.abort(new Error("媒体资源租约已过期，处理已停止。")), remainingLease());
  watchdog.unref();
  let renewing: Promise<void> | undefined;
  let released: Promise<void> | undefined;
  const renew = async () => {
    const space = await statfs(scratch, { bigint: true });
    if (space.bavail * space.bsize < BigInt(DISK_FLOOR)) throw new MediaCapacityError("media_disk_full", "磁盘可用空间已不足，媒体处理已停止，原素材保留。");
    leaseStartedAt = Date.now();
    const kept = await request.db.query("update media_resource_leases set lease_until=now()+make_interval(secs=>$2) where id=$1 and lease_until>now() returning id", [id, LEASE_SECONDS]);
    if (!kept.rows.length) throw new Error("媒体任务资源租约已丢失。");
    clearTimeout(watchdog);
    watchdog = setTimeout(() => controller.abort(new Error("媒体资源租约已过期，处理已停止。")), remainingLease());
    watchdog.unref();
  };
  const timer = setInterval(() => {
    renewing ??= renew().catch(error => { console.error("[media-admission] lease renewal failed", error); controller.abort(error); }).finally(() => { renewing = undefined; });
  }, HEARTBEAT_MS);
  timer.unref();
  return {
    scratchRoot: scratch,
    signal: controller.signal,
    release() {
      clearInterval(timer);
      clearTimeout(watchdog);
      request.signal?.removeEventListener("abort", relay);
      released ??= (async () => {
        await renewing;
        clearTimeout(watchdog);
        await request.db.query("delete from media_resource_leases where id=$1", [id]);
      })();
      return released;
    },
  };
}
