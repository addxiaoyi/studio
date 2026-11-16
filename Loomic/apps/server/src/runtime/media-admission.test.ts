import { mkdtemp, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireMediaBudget } from "./media-admission.js";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, statfs: vi.fn(fs.statfs) };
});

const MIB = 1024 ** 2;
const MIN_ADMISSION_RESERVE = 2 * 1024 ** 3;
const MIN_RUNNING_RESERVE = 512 * MIB;
const LEASE_RENEWAL_MS = 10_000;
const roots: string[] = [];

function makeDatabase() {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("select count(*)")) return { rows: [{ count: "0", bytes: "0" }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const db = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => sql.startsWith("update media_resource_leases")
      ? { rows: [{ id: "lease" }] }
      : { rows: [] }),
  };
  return { db: db as unknown as Pool, client };
}

beforeEach(() => {
  vi.mocked(statfs).mockReset();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "helstera-media-admission-"));
  roots.push(root);
  return root;
}

function availableBytes(bytes: number) {
  return { bavail: BigInt(bytes), bsize: 1n } as never;
}

describe("media scratch admission", () => {
  it("keeps a 2 GiB reserve at the exact admission boundary", async () => {
    const root = await makeRoot();
    const { db } = makeDatabase();
    const reserveBytes = 64 * MIB;
    vi.mocked(statfs).mockResolvedValue({
      bavail: BigInt(reserveBytes + MIN_ADMISSION_RESERVE), bsize: 1n,
    } as never);

    const lease = await acquireMediaBudget({ db, storageRoot: root, kind: "capture", reserveBytes });
    await lease.release();

    vi.mocked(statfs).mockResolvedValue({
      bavail: BigInt(reserveBytes + MIN_ADMISSION_RESERVE - 1),
      bsize: 1n,
    } as never);
    const candidate = makeDatabase();

    await expect(
      acquireMediaBudget({ db: candidate.db, storageRoot: root, kind: "capture", reserveBytes }),
    ).rejects.toMatchObject({ code: "media_disk_full" });
    expect(candidate.client.query.mock.calls.some(([sql]) => sql.startsWith("insert into media_resource_leases"))).toBe(false);
  });

  it("keeps an active lease at the 512 MiB renewal boundary", async () => {
    const root = await makeRoot();
    const { db } = makeDatabase();
    vi.useFakeTimers();
    vi.mocked(statfs)
      .mockResolvedValueOnce(availableBytes(MIN_ADMISSION_RESERVE + MIB))
      .mockResolvedValue(availableBytes(MIN_RUNNING_RESERVE));

    try {
      const lease = await acquireMediaBudget({ db, storageRoot: root, kind: "capture", reserveBytes: MIB });
      await vi.advanceTimersByTimeAsync(LEASE_RENEWAL_MS);

      expect(lease.signal.aborted).toBe(false);
      await lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops an active lease one byte below the 512 MiB renewal boundary", async () => {
    const root = await makeRoot();
    const { db } = makeDatabase();
    const logFailure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    vi.mocked(statfs)
      .mockResolvedValueOnce(availableBytes(MIN_ADMISSION_RESERVE + MIB))
      .mockResolvedValue(availableBytes(MIN_RUNNING_RESERVE - 1));

    try {
      const lease = await acquireMediaBudget({ db, storageRoot: root, kind: "capture", reserveBytes: MIB });
      await vi.advanceTimersByTimeAsync(LEASE_RENEWAL_MS);

      expect(lease.signal.aborted).toBe(true);
      await lease.release();
    } finally {
      vi.useRealTimers();
      logFailure.mockRestore();
    }
  });
});
