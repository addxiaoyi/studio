import { describe, expect, it } from "vitest";
import { isTransientAgentBrowserError } from "./agent-browser-errors.js";

describe("agent browser dependency errors", () => {
  it.each([
    { code: "57P01" },
    { code: "53300" },
    { message: "connection terminated unexpectedly" },
    { cause: { message: "ETIMEDOUT while waiting for PostgreSQL" } },
  ])("marks transient failures as retryable: $code $message", (error) => {
    expect(isTransientAgentBrowserError(error)).toBe(true);
  });

  it.each([{ code: "23505" }, { message: "invalid browser session" }, null])(
    "does not classify permanent failures as transient: $code $message",
    (error) => {
      expect(isTransientAgentBrowserError(error)).toBe(false);
    },
  );
});
