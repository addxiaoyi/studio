export async function prepareTestPostgres(client) {
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext('helstera-test-pgcrypto-extension'))",
    );
    await client.query(
      "create extension if not exists pgcrypto with schema public",
    );
    await client.query("commit");
  } catch (error) {
    if (!connected) throw error;
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Test database preparation and rollback failed",
      );
    }
    throw error;
  } finally {
    await client.end();
  }
}
