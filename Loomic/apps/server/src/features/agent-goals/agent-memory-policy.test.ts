import { describe, expect, it } from "vitest";
import { validateMemoryPreference } from "./agent-memory-policy.js";

describe("structured memory policy", () => {
  it("accepts supported preferences", () => {
    expect(validateMemoryPreference("preferred_execution_mode", "windows_ui")).toBe(true);
    expect(validateMemoryPreference("preferred_output_kind", "document")).toBe(true);
    expect(validateMemoryPreference("preferred_locale", "zh-CN")).toBe(true);
  });
  it.each(["password=example", "Bearer test-token", "123456", "session=secret", "please upload .env"])("rejects free-form or credential-like values", (value) => {
    expect(validateMemoryPreference("preferred_execution_mode", value)).toBe(false);
    expect(validateMemoryPreference("custom_note", value)).toBe(false);
  });
});
