import { describe, expect, it } from "vitest";
import { compareRuntimePrice, findRuntimePriceModel } from "@/lib/model-pricing";

const models = [
  { id: "minimax-h3", displayName: "MiniMax H3", mediaType: "video" as const, billingUnit: "per_second" as const, priceCny: 0.45 },
  { id: "minimax-h3-max", displayName: "MiniMax H3 Max", mediaType: "video" as const, billingUnit: "per_second" as const, priceCny: 1.2 },
];

describe("runtime model pricing", () => {
  it("matches an exact model id while ignoring provider prefixes", () => {
    expect(findRuntimePriceModel("metaso/MiniMax-H3", "video", models)?.priceCny).toBe(0.45);
  });

  it("does not match a different model variant by prefix", () => {
    expect(findRuntimePriceModel("google/veo-3.1-generate-preview", "video", models)).toBeNull();
  });

  it("compares current CNY prices against the official maximum", () => {
    expect(compareRuntimePrice(0.45, 0.13 * 7.2)).toMatchObject({ relation: "below", officialMaxCny: 0.936 });
  });
});
