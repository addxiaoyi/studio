import { expect, it, vi } from "vitest";
import { singleImageSubmission } from "./image-submission.js";

const input = { title: "主图", prompt: "商品主图", model: "gpt-image-2", aspectRatio: "1:1" };

it("deduplicates the same image request without merging different prompts", async () => {
  const submit = vi.fn(async () => ({ jobId: "one" }));
  const once = singleImageSubmission(submit);
  const jobs = await Promise.all([once(input), once({ ...input, prompt: "另一个版本" }), once(input)]);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(jobs).toEqual([{ jobId: "one" }, { jobId: "one" }, { jobId: "one", reused: true }]);
});

it("does not resubmit after an ambiguous rejection", async () => {
  const submit = vi.fn(async () => { throw new Error("timeout"); });
  const once = singleImageSubmission(submit);
  await expect(once(input)).rejects.toThrow("timeout");
  await expect(once(input)).rejects.toThrow("timeout");
  expect(submit).toHaveBeenCalledTimes(1);
});

it("allows a separate run to submit its own task", async () => {
  const submit = vi.fn(async () => ({ jobId: "job" }));
  await singleImageSubmission(submit)(input);
  await singleImageSubmission(submit)(input);
  expect(submit).toHaveBeenCalledTimes(2);
});
