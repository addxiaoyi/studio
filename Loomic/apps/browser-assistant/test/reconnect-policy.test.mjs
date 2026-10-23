import test from "node:test";
import assert from "node:assert/strict";
import { getReconnectDelay } from "../src/reconnect-policy.js";

test("uses bounded exponential retry delays", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map(getReconnectDelay),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000],
  );
  assert.equal(getReconnectDelay(8), null);
  assert.equal(getReconnectDelay(-1), null);
});
