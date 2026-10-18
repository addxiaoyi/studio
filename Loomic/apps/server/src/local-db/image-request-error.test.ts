import { expect, it } from "vitest";
import { imageOutcomeUnknown, imageRequestRejection } from "./image-request-error.js";

it.each(["provider returned 504: timeout", "provider returned 502: gateway", "fetch failed", "provider returned no image"])("does not retry an uncertain result: %s", (message) => {
  expect(imageOutcomeUnknown(new Error(message))).toMatchObject({ code: "upstream_outcome_unknown" });
});

it.each(["provider returned 400: invalid size", "provider returned 401: invalid key", "provider returned 429: rate limit"])("keeps definite rejection distinct: %s", (message) => {
  expect(imageOutcomeUnknown(new Error(message))).toBeNull();
});

it("classifies request refusal without returning the upstream body", () => {
  const error = imageRequestRejection(new Error('provider returned 400: {"message":"该请求可能因安全政策被拦截，或不适合进行图像生成。"}'));
  expect(error).toMatchObject({ code: "safety_filter" });
  expect(error?.message).toContain("不会自动重试");
  expect(error?.message).not.toContain("provider returned");
});

it.each(["provider returned 504: timeout", "provider returned 400: invalid size", "provider returned 401: invalid key"])("does not misclassify %s", (message) => {
  expect(imageRequestRejection(new Error(message))).toBeNull();
});
