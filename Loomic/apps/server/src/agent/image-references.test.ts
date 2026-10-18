import { expect, it } from "vitest";
import { resolveImageReferences } from "./image-references.js";

it("keeps attachment order even when downloads finish in reverse order", () => {
  expect(resolveImageReferences([
    { assetId: "clothes", url: "https://assets.test/clothes" },
    { assetId: "model", url: "https://assets.test/model" },
  ], { model: "data:image/png;base64,bW9kZWw=", clothes: "data:image/png;base64,Y2xvdGhlcw==" }))
    .toEqual(["data:image/png;base64,Y2xvdGhlcw==", "data:image/png;base64,bW9kZWw="]);
});

it("sends one representation per attachment and falls back only for missing downloads", () => {
  expect(resolveImageReferences([
    { assetId: "one", url: "https://assets.test/one" },
    { assetId: "two", url: "https://assets.test/two" },
    { assetId: "one", url: "https://assets.test/one" },
  ], { one: "data:image/png;base64,b25l" })).toEqual([
    "data:image/png;base64,b25l", "https://assets.test/two",
  ]);
});

it("does not forward unresolved storage markers or invent missing references", () => {
  expect(resolveImageReferences([{ assetId: "missing", url: "oss://private/asset" }], {})).toEqual([]);
  expect(resolveImageReferences([], {})).toEqual([]);
});
