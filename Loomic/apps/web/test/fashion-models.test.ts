import { expect, it } from "vitest";
import { fashionModels } from "@/lib/fashion-models";
const model = {
  id: "image",
  displayName: "图像模型",
  description: "",
  provider: "configured",
  creditCost: 2.5,
  accessible: true,
  capabilities: { imageToImage: true },
};
const { creditCost: _price, ...unpriced } = model;
it("shows actual credits and disables incompatible, unaffordable and unpriced models", () => {
  const choices = fashionModels([
    model,
    { ...model, id: "text", capabilities: { imageToImage: false } },
    { ...model, id: "expensive", accessible: false },
    { ...unpriced, id: "unpriced" },
  ]);
  expect(choices[0]).toMatchObject({
    priceLabel: "2.5 积分 / 张",
    available: true,
  });
  expect(choices.slice(1).every((item) => !item.available)).toBe(true);
});
it("keeps token billing explicit and deduplicates unavailable entries", () => {
  const choices = fashionModels(
    [
      {
        ...unpriced,
        billingUnit: "per_million_tokens",
        providerInputTokenPriceCny: 3,
        providerOutputTokenPriceCny: 4,
      },
    ],
    [model],
  );
  expect(choices).toHaveLength(1);
  expect(choices[0]?.priceLabel).toContain("Token");
  expect(choices[0]?.available).toBe(true);
});
