import { expect, it } from "vitest";
import { KUAIPAO_IMAGE_MODELS, getKuaipaoImagePrice, getKuaipaoImageRates } from "./kuaipao-images.js";

it.each(KUAIPAO_IMAGE_MODELS)("prices all three sizes with the approved margin: %s", (model) => {
  expect(getKuaipaoImageRates(model).map((rate) => rate.priceCredits)).toEqual([0.2, 0.32, 1.2]);
  expect(getKuaipaoImagePrice(model, "standard")).toBe(0.2);
});
it("does not treat retired size-suffixed model ids as current models", () => {
  expect(getKuaipaoImageRates("gpt-image-2.5-2k")).toEqual([]);
});
