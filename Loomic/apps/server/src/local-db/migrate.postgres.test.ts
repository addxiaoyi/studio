import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLocalMigrations,
  applyLocalSchema,
  migrationChecksum,
} from "./migrate.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "local migration transactions",
  () => {
    const cleanups: Array<() => Promise<void>> = [];
    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      for (const close of cleanups.splice(0)) await close();
    });

    async function fixture() {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Migration tests require loopback PostgreSQL");
      const id = randomUUID().replaceAll("-", "");
      const schema = `migration_${id}`;
      const admin = new Pool({ connectionString: url.href });
      await admin.query(`create schema ${schema}`);
      const options = `-c search_path=${schema},public`;
      const first = new Pool({
        connectionString: url.href,
        options,
        application_name: `migration-first-${id}`,
        max: 1,
      });
      const second = new Pool({
        connectionString: url.href,
        options,
        application_name: `migration-second-${id}`,
        max: 1,
      });
      const directory = await mkdtemp(join(tmpdir(), "helstera-migrations-"));
      cleanups.push(async () => {
        await Promise.all([first.end(), second.end()]);
        try {
          await admin.query(`drop schema ${schema} cascade`);
        } finally {
          await admin.end();
          await rm(directory, { recursive: true, force: true });
        }
      });
      await first.query(
        "create table schema_migrations(version text primary key,checksum text not null); create table migration_events(label text not null); create sequence attempts;",
      );
      return { directory, first, second, admin, id, schema, url: url.href };
    }

    it.each(["increments", "bootstrap"])(
      "rejects a fallback ledger before %s can write into a different schema",
      async (mode) => {
        const f = await fixture();
        const target = `migration_target_${f.id}`;
        await f.admin.query(
          `create schema ${target}; create table ${target}.migration_events(label text not null)`,
        );
        const pool = new Pool({
          connectionString: f.url,
          options: `-c search_path=${target},${f.schema},public`,
          max: 1,
        });
        cleanups.unshift(async () => {
          await pool.end();
          await f.admin.query(`drop schema ${target} cascade`);
        });
        const file = join(f.directory, "20261115000004_wrong_scope.sql");
        await writeFile(
          file,
          "insert into migration_events values('wrong-schema');",
        );
        const bootstrap = join(f.directory, "bootstrap.fixture");
        await writeFile(
          bootstrap,
          "create table if not exists schema_migrations(version text primary key,checksum text not null); insert into migration_events values('bootstrap-side-effect');",
        );
        const migrate =
          mode === "bootstrap"
            ? applyLocalSchema(pool, bootstrap, f.directory)
            : applyLocalMigrations(pool, f.directory);
        await expect(migrate).rejects.toThrow(/ledger.*schema/i);
        expect(
          (await f.first.query("select * from schema_migrations")).rows,
        ).toEqual([]);
        expect(
          (await pool.query("select * from migration_events")).rows,
        ).toEqual([]);
      },
    );

    it("accepts a local ledger even when a different ledger exists later in search_path", async () => {
      const f = await fixture();
      const target = `migration_target_${f.id}`;
      await f.admin.query(`create schema ${target};
        create table ${target}.schema_migrations(version text primary key,checksum text not null);
        create table ${target}.migration_events(label text not null)`);
      const pool = new Pool({
        connectionString: f.url,
        options: `-c search_path=${target},${f.schema},public`,
        max: 1,
      });
      cleanups.unshift(async () => {
        await pool.end();
        await f.admin.query(`drop schema ${target} cascade`);
      });
      await writeFile(
        join(f.directory, "20261115000004_local_scope.sql"),
        "insert into migration_events values('local-schema');",
      );
      expect(await applyLocalMigrations(pool, f.directory)).toEqual([
        "20261115000004_local_scope",
      ]);
      expect(
        (await pool.query("select label from migration_events")).rows,
      ).toEqual([{ label: "local-schema" }]);
      expect(
        (await f.first.query("select * from schema_migrations")).rows,
      ).toEqual([]);
    });

    it("rolls back a migration that changes its target schema before recording the receipt", async () => {
      const f = await fixture();
      await writeFile(
        join(f.directory, "20261115000005_scope_switch.sql"),
        "insert into migration_events values('partial'); set local search_path=public;",
      );
      await expect(applyLocalMigrations(f.first, f.directory)).rejects.toThrow(
        /ledger.*schema/i,
      );
      expect(
        (await f.first.query("select * from migration_events")).rows,
      ).toEqual([]);
      expect(
        (await f.first.query("select * from schema_migrations")).rows,
      ).toEqual([]);
      expect(
        (await f.first.query("select current_schema() as schema")).rows[0]
          ?.schema,
      ).toBe(f.schema);
    });

    it("rolls back bootstrap changes when its SQL changes the target schema", async () => {
      const f = await fixture();
      const bootstrap = join(f.directory, "bootstrap.fixture");
      await writeFile(
        bootstrap,
        "create table unexpected_bootstrap(id integer); set search_path=public;",
      );
      await expect(
        applyLocalSchema(f.first, bootstrap, f.directory),
      ).rejects.toThrow(/ledger.*schema/i);
      expect(
        (
          await f.first.query(
            "select current_schema() as schema,to_regclass($1) as unexpected",
            [`${f.schema}.unexpected_bootstrap`],
          )
        ).rows[0],
      ).toEqual({ schema: f.schema, unexpected: null });
    });

    it("serializes concurrent deployers before executing the same migration", async () => {
      const f = await fixture();
      const blocker = await f.admin.connect();
      const lock = Number.parseInt(f.id.slice(0, 7), 16);
      await blocker.query("select pg_advisory_lock($1)", [lock]);
      await writeFile(
        join(f.directory, "20261115000001_concurrent.sql"),
        `select nextval('attempts'); select pg_advisory_xact_lock(${lock}); insert into migration_events values('once');`,
      );
      const runs = [
        applyLocalMigrations(f.first, f.directory),
        applyLocalMigrations(f.second, f.directory),
      ];
      const completed = Promise.allSettled(runs);
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const waiting = await f.admin.query<{ count: number }>(
            "select count(*)::int as count from pg_stat_activity where application_name=any($1::text[]) and wait_event_type='Lock'",
            [[`migration-first-${f.id}`, `migration-second-${f.id}`]],
          );
          if (waiting.rows[0]?.count === 2) break;
          if (Date.now() >= deadline)
            throw new Error(
              "Concurrent migration clients did not reach their lock boundary",
            );
          await delay(20);
        }
      } finally {
        await blocker.query("select pg_advisory_unlock($1)", [lock]);
        blocker.release();
      }
      const outcomes = await completed;
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
      const versions = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      );
      expect(versions).toEqual(["20261115000001_concurrent"]);
      expect(
        (await f.first.query("select label from migration_events")).rows,
      ).toEqual([{ label: "once" }]);
      expect(
        (await f.first.query("select last_value::int from attempts")).rows[0]
          ?.last_value,
      ).toBe(1);
    }, 15_000);

    it("rolls back failed migration writes and permits a corrected retry from another client", async () => {
      const f = await fixture();
      const path = join(f.directory, "20261115000002_recovery.sql");
      await writeFile(
        path,
        "insert into migration_events values('partial'); select missing_column from migration_events;",
      );
      await expect(
        applyLocalMigrations(f.first, f.directory),
      ).rejects.toThrow();
      expect(
        (await f.first.query("select * from migration_events")).rows,
      ).toEqual([]);
      expect(
        (await f.first.query("select * from schema_migrations")).rows,
      ).toEqual([]);
      await writeFile(
        path,
        "insert into migration_events values('recovered');",
      );
      expect(await applyLocalMigrations(f.second, f.directory)).toEqual([
        "20261115000002_recovery",
      ]);
      expect(
        (await f.first.query("select label from migration_events")).rows,
      ).toEqual([{ label: "recovered" }]);
    });

    it("protects bootstrap DDL with the same lock as incremental migrations", async () => {
      const f = await fixture();
      const bootstrap = join(f.directory, "bootstrap.fixture");
      await writeFile(
        bootstrap,
        "create table if not exists schema_migrations(version text primary key,checksum text not null); create table if not exists bootstrap_table(id integer); select pg_sleep(0.08);",
      );
      await f.first.query("drop table schema_migrations");
      await writeFile(
        join(f.directory, "20261115000003_bootstrap.sql"),
        "insert into bootstrap_table values(1);",
      );
      const outcomes = await Promise.allSettled([
        applyLocalSchema(f.first, bootstrap, f.directory),
        applyLocalSchema(f.second, bootstrap, f.directory),
      ]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
      expect(
        (await f.first.query("select id from bootstrap_table")).rows,
      ).toEqual([{ id: 1 }]);
      expect(
        (await f.first.query("select version from schema_migrations")).rows,
      ).toEqual([{ version: "20261115000003_bootstrap" }]);
    });

    it("retains legacy drift warnings without reapplying or rewriting the applied checksum", async () => {
      const f = await fixture();
      vi.stubEnv("MIGRATION_STRICT_CHECKSUM", "0");
      const warning = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      await f.first.query(
        "insert into schema_migrations values('20261115000001_old','historical-checksum')",
      );
      await writeFile(
        join(f.directory, "20261115000001_old.sql"),
        "insert into migration_events values('must-not-run');",
      );
      const sql = "insert into migration_events values('new');\r\n";
      await writeFile(join(f.directory, "20261115000002_new.sql"), sql);
      expect(await applyLocalMigrations(f.first, f.directory)).toEqual([
        "20261115000002_new",
      ]);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Migration checksum mismatch"),
      );
      expect(
        (await f.first.query("select label from migration_events")).rows,
      ).toEqual([{ label: "new" }]);
      expect(
        (
          await f.first.query(
            "select checksum from schema_migrations order by version",
          )
        ).rows,
      ).toEqual([
        { checksum: "historical-checksum" },
        { checksum: migrationChecksum(sql.replaceAll("\r\n", "\n")) },
      ]);
    });

    it("strict checksum rejection releases the lock without applying later files", async () => {
      const f = await fixture();
      vi.stubEnv("MIGRATION_STRICT_CHECKSUM", "1");
      const original = "insert into migration_events values('original');";
      await f.first.query(
        "insert into schema_migrations values('20261115000001_old',$1)",
        [migrationChecksum(original)],
      );
      await writeFile(join(f.directory, "20261115000001_old.sql"), "select 1;");
      await writeFile(
        join(f.directory, "20261115000002_new.sql"),
        "insert into migration_events values('new');",
      );
      await expect(applyLocalMigrations(f.first, f.directory)).rejects.toThrow(
        "Migration checksum mismatch",
      );
      expect(
        (await f.first.query("select label from migration_events")).rows,
      ).toEqual([]);
      await writeFile(join(f.directory, "20261115000001_old.sql"), original);
      expect(await applyLocalMigrations(f.second, f.directory)).toEqual([
        "20261115000002_new",
      ]);
    });
  },
);
