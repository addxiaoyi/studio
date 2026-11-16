import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareTestPostgres } from "./prepare-test-postgres.mjs";

function fixture(failDdl = false) {
  const commands = [];
  const ddlError = new Error("extension denied");
  return {
    commands,
    ddlError,
    client: {
      async connect() {
        commands.push("connect");
      },
      async query(sql) {
        commands.push(sql);
        if (failDdl && sql.startsWith("create extension")) throw ddlError;
      },
      async end() {
        commands.push("end");
      },
    },
  };
}

test("prepares the shared extension before workers start and releases its transaction lock", async () => {
  const f = fixture();
  await prepareTestPostgres(f.client);
  assert.deepEqual(f.commands, [
    "connect",
    "begin",
    "select pg_advisory_xact_lock(hashtext('helstera-test-pgcrypto-extension'))",
    "create extension if not exists pgcrypto with schema public",
    "commit",
    "end",
  ]);
});

test("rolls back the lock and closes the connection after failed extension DDL", async () => {
  const f = fixture(true);
  await assert.rejects(
    prepareTestPostgres(f.client),
    (error) => error === f.ddlError,
  );
  assert.deepEqual(f.commands.slice(-2), ["rollback", "end"]);
  assert.equal(f.commands.includes("commit"), false);
});

test("closes a failed connection without attempting a transaction", async () => {
  const f = fixture();
  const refused = new Error("connection refused");
  f.client.connect = async () => {
    throw refused;
  };
  await assert.rejects(
    prepareTestPostgres(f.client),
    (error) => error === refused,
  );
  assert.deepEqual(f.commands, ["end"]);
});

test("preserves both DDL and rollback errors and still closes the client", async () => {
  const f = fixture(true);
  const query = f.client.query;
  const rollbackError = new Error("connection lost during rollback");
  f.client.query = async (sql) => {
    if (sql === "rollback") throw rollbackError;
    await query(sql);
  };
  await assert.rejects(prepareTestPostgres(f.client), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [f.ddlError, rollbackError]);
    return true;
  });
  assert.equal(f.commands.at(-1), "end");
});
