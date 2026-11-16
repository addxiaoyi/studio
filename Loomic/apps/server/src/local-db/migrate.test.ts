import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { applyLocalMigrations, migrationChecksum } from "./migrate.js";

const server = fileURLToPath(new URL("../../", import.meta.url));

describe("local migration library boundary", () => {
  it.each([undefined, "postgresql://postgres@127.0.0.1:1/not_used"])(
    "imports without requiring or connecting to DATABASE_URL=%s",
    (connection) => {
      const env = { ...process.env, DATABASE_URL: connection };
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          'await import("./src/local-db/migrate.ts"); console.log("migration-library-imported");',
        ],
        {
          cwd: server,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 10_000,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout.trim()).toBe("migration-library-imported");
    },
  );

  it("still refuses direct CLI execution without a connection", () => {
    const env = { ...process.env, DATABASE_URL: undefined };
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/local-db/migrate.ts"],
      {
        cwd: server,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("DATABASE_URL is required");
  });

  it("keeps LF, CRLF and BOM copies of a migration on one checksum", () => {
    expect(migrationChecksum("select 1;\n")).toBe(
      migrationChecksum("\uFEFFselect 1;\r\n"),
    );
  });

  it("discards a session whose migration lock cannot be released and preserves both failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-migration-lock-"));
    const migrationError = new Error("migration statement failed");
    const unlockError = new Error("connection lost during unlock");
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("select hashtextextended"))
        return { rows: [{ key: "123", schema: "public" }] };
      if (sql.startsWith("select current_schema()"))
        return { rows: [{ schema: "public", ledger_schema: "public" }] };
      if (sql.startsWith("select pg_advisory_unlock")) throw unlockError;
      if (sql === "select failure;") throw migrationError;
      return { rows: [] };
    });
    const pool = {
      connect: async () => ({ query, release }),
    } as unknown as Pool;
    try {
      await writeFile(
        join(directory, "20261115000001_failure.sql"),
        "select failure;",
      );
      await expect(applyLocalMigrations(pool, directory)).rejects.toMatchObject(
        { errors: [migrationError, unlockError] },
      );
      expect(query).toHaveBeenCalledWith("rollback");
      expect(release).toHaveBeenCalledExactlyOnceWith(unlockError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("discards a session after rollback failure even when its lock can be released", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "helstera-migration-rollback-"),
    );
    const statementError = new Error("statement failed");
    const rollbackError = new Error("rollback outcome unknown");
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("select hashtextextended"))
        return { rows: [{ key: "123", schema: "public" }] };
      if (sql.startsWith("select current_schema()"))
        return { rows: [{ schema: "public", ledger_schema: "public" }] };
      if (sql.startsWith("select pg_advisory_unlock"))
        return { rows: [{ unlocked: true }] };
      if (sql === "select failure;") throw statementError;
      if (sql === "rollback") throw rollbackError;
      return { rows: [] };
    });
    try {
      await writeFile(
        join(directory, "20261115000001_failure.sql"),
        "select failure;",
      );
      const pool = {
        connect: async () => ({ query, release }),
      } as unknown as Pool;
      await expect(applyLocalMigrations(pool, directory)).rejects.toMatchObject(
        { errors: [statementError, rollbackError] },
      );
      expect(release).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ errors: [statementError, rollbackError] }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
