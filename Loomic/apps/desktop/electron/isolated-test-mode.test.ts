import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { isolatedTestDirectory } from "./isolated-test-mode.js";

describe("isolated desktop test mode", () => {
  it("keeps normal startup unchanged unless explicitly enabled", () => {
    expect(isolatedTestDirectory({})).toBeNull();
    expect(isolatedTestDirectory({ HELSTERA_TEST_USER_DATA: resolve("test") })).toBeNull();
  });

  it("requires an absolute isolated user data directory", () => {
    expect(() => isolatedTestDirectory({ HELSTERA_ISOLATED_TEST: "1" })).toThrow();
    expect(() => isolatedTestDirectory({ HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: "relative" })).toThrow();
    const directory = resolve("test-profile");
    expect(isolatedTestDirectory({ HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: directory })).toBe(directory);
  });
});
