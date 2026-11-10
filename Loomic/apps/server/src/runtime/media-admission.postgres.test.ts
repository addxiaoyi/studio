import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { acquireMediaBudget, MediaCapacityError, withMediaBudget } from "./media-admission.js";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, statfs: vi.fn(fs.statfs) };
});

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("media admission with real PostgreSQL", () => {
  it("serializes separate clients, rejects low space and releases canceled work", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (url.hostname !== "127.0.0.1") throw new Error("Local test database required");
    const admin = new Pool({ connectionString: url.href });
    const schema = `media_budget_${randomUUID().replaceAll("-", "")}`;
    const root = await mkdtemp(join(tmpdir(), "helstera-budget-test-"));
    await admin.query(`create schema ${schema}`);
    const first = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    const second = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    try {
      await first.query(await readFile(new URL("../local-db/migrations/20261110000000_media_resource_leases.sql", import.meta.url), "utf8"));
      const roomy = { bavail: 8n * 1024n ** 3n, bsize: 1n } as never;
      vi.mocked(statfs).mockResolvedValue(roomy);
      const request = { storageRoot: root, reserveBytes: 1024 ** 3, kind: "capture" as const };
      const claims = await Promise.allSettled([acquireMediaBudget({ ...request, db: first }), acquireMediaBudget({ ...request, db: second })]);
      expect(claims.filter(claim => claim.status === "fulfilled")).toHaveLength(1);
      const denied = claims.find(claim => claim.status === "rejected") as PromiseRejectedResult;
      expect(denied.reason).toBeInstanceOf(MediaCapacityError);
      expect(denied.reason.code).toBe("media_capacity_busy");
      for (const claim of claims) if (claim.status === "fulfilled") await claim.value.release();
      expect((await first.query("select * from media_resource_leases")).rows).toHaveLength(0);
      const lateAbort = new AbortController();
      await expect(withMediaBudget({ ...request, db: second, signal: lateAbort.signal }, async () => {
        lateAbort.abort(new Error("Canceled during final write"));
        return "must not report completion";
      })).rejects.toThrow("Canceled during final write");
      expect((await first.query("select * from media_resource_leases")).rows).toHaveLength(0);

      vi.mocked(statfs).mockResolvedValue({ bavail: 128n * 1024n ** 2n, bsize: 1n } as never);
      await expect(acquireMediaBudget({ ...request, db: first })).rejects.toMatchObject({ code: "media_disk_full" });
      expect((await first.query("select * from media_resource_leases")).rows).toHaveLength(0);

      vi.mocked(statfs).mockResolvedValue(roomy);
      const controller = new AbortController();
      const lease = await acquireMediaBudget({ ...request, db: second, signal: controller.signal });
      controller.abort(new Error("User canceled"));
      expect(lease.signal.aborted).toBe(true);
      await Promise.all([lease.release(), lease.release()]);
      expect((await first.query("select * from media_resource_leases")).rows).toHaveLength(0);
    } finally {
      vi.mocked(statfs).mockRestore();
      await Promise.all([first.end(), second.end()]);
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
