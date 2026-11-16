import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertWorkerDependencies } from "./worker-readiness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("worker readiness", () => {
  it("checks the database and writable media storage before ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-worker-ready-"));
    roots.push(root);
    const query = vi.fn(async () => ({ rows: [] }));

    await assertWorkerDependencies(
      { query } as unknown as Pick<import("pg").Pool, "query">,
      root,
    );

    expect(query).toHaveBeenCalledWith("select 1");
  });

  it("fails readiness when the storage root is unavailable", async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    await expect(
      assertWorkerDependencies(
        { query } as unknown as Pick<import("pg").Pool, "query">,
        join(tmpdir(), "helstera-missing-storage"),
      ),
    ).rejects.toThrow();
    expect(query).toHaveBeenCalledWith("select 1");
  });
});
