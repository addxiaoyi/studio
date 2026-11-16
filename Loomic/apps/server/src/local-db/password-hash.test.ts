import { expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./auth.js";

it.each([
  "salt:zz",
  "salt:0",
  "salt:",
  "salt:00",
  `${"ab".repeat(16)}:${"cd".repeat(64)}:extra`,
])("rejects a malformed stored password hash %s", async (hash) => {
  expect(await verifyPassword("any-password", hash)).toBe(false);
});

it("validates only the matching password for a supported stored hash", async () => {
  const hash = await hashPassword("original-test-password");
  expect(await verifyPassword("original-test-password", hash)).toBe(true);
  expect(await verifyPassword("different-test-password", hash)).toBe(false);
  expect(
    await verifyPassword("original-test-password", `${hash}:ignored`),
  ).toBe(false);
});
