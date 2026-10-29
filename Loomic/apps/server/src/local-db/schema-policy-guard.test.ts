import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

/**
 * schema.sql is replayed unconditionally on every deploy (see migrate.ts: it runs the whole
 * file, then applies checksum-tracked migrations). Any data mutation left in it therefore
 * executes on every release.
 *
 * That is how provider_models.failure_count/cooldown_until, enabled flags and price_credits
 * kept getting reset to hardcoded values: eleven product-policy UPDATEs lived in schema.sql.
 * They now live in migrations/20261029000001_provider_model_policy_once.sql.
 *
 * This guard keeps them out. Schema = structure. Policy = migration.
 */
describe("schema.sql", () => {
  it("contains no data mutations, because it is replayed on every deploy", () => {
    const sql = readFileSync(schemaPath, "utf8");
    const offenders = sql
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /^(update|delete)\s/i.test(line));

    expect(
      offenders.map(({ line, number }) => `${number}: ${line.slice(0, 90)}`),
    ).toEqual([]);
  });

  it("still creates the schema tables it is responsible for", () => {
    const sql = readFileSync(schemaPath, "utf8");
    expect(sql).toContain("create table if not exists provider_models");
    expect(sql).toContain("create table if not exists schema_migrations");
  });
});
