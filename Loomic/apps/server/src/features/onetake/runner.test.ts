import { afterEach, describe, expect, it, vi } from "vitest";
import { oneTakeModels } from "./runner.js";

afterEach(() => vi.unstubAllEnvs());

describe("OneTake model availability", () => {
  it("defaults to the supported upstream models", () => {
    vi.stubEnv("HELSTERA_ONETAKE_MODELS", undefined);
    expect(oneTakeModels()).toEqual(["tiny", "base", "small", "medium", "large-v3"]);
  });

  it("preserves an explicit server allowlist and removes duplicates", () => {
    vi.stubEnv("HELSTERA_ONETAKE_MODELS", "tiny, base,tiny");
    expect(oneTakeModels()).toEqual(["tiny", "base"]);
  });

  it.each(["", " , ", "base,unknown", "large"]) ("rejects an invalid allowlist: %s", value => {
    vi.stubEnv("HELSTERA_ONETAKE_MODELS", value);
    expect(() => oneTakeModels()).toThrow("unsupported speech model");
  });
});
