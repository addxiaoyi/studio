import type { SubmitImageJobFn } from "./tools/image-generate.js";

export function singleImageSubmission(submit: SubmitImageJobFn): SubmitImageJobFn {
  const pending = new Map<string, ReturnType<SubmitImageJobFn>>();
  return (input) => {
    const key = stableImageInput(input);
    const existing = pending.get(key);
    if (existing) return existing.then((job) => ({ ...job, reused: true }));
    // Reserve the slot before invoking submit, including synchronous failures.
    // Keep rejected promises: a timeout does not prove the upstream rejected work.
    const submission = Promise.resolve().then(() => submit(input));
    pending.set(key, submission);
    return submission;
  };
}

function stableImageInput(input: Parameters<SubmitImageJobFn>[0]): string {
  return JSON.stringify({
    aspectRatio: input.aspectRatio ?? null,
    inputImages: input.inputImages ?? [],
    model: input.model,
    prompt: input.prompt,
    quality: input.quality ?? null,
    title: input.title ?? null,
  });
}
