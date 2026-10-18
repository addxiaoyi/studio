import { describe, expect, it } from "vitest";
import { ReplicateImageProvider, buildReplicateImageInput } from "./replicate-image.js";
import { getModelCallProfile } from "../../local-db/model-call-profiles.js";

const reference = "https://images.example/reference.png";

describe("Replicate image request fixtures", () => {
  it("rejects inline reference data before issuing a Replicate request", () => {
    expect(() => buildReplicateImageInput({
      model: "black-forest-labs/flux-kontext-pro",
      prompt: "edit",
      inputImages: ["data:image/png;base64,cGlj"],
    })).toThrow(/public HTTP\(S\) URLs/);
  });

  it("uses a single input_image URL for Flux Kontext", () => {
    const { input } = buildReplicateImageInput({ model: "black-forest-labs/flux-kontext-pro", prompt: "edit", inputImages: [reference] });
    expect(input).toMatchObject({ prompt: "edit", input_image: reference, aspect_ratio: "1:1" });
    expect(input).not.toHaveProperty("image_input");
  });

  it("uses input_images and native quality for GPT Image", () => {
    const { input } = buildReplicateImageInput({ model: "openai/gpt-image-1", prompt: "edit", aspectRatio: "16:9", inputImages: [reference], quality: "hd" });
    expect(input).toMatchObject({ input_images: [reference], aspect_ratio: "3:2", quality: "high" });
  });

  it("uses image_input for Nano Banana", () => {
    const { input } = buildReplicateImageInput({ model: "google/nano-banana", prompt: "edit", inputImages: [reference] });
    expect(input).toMatchObject({ image_input: [reference] });
  });

  it("rejects reference images for text-only Imagen", () => {
    expect(() => buildReplicateImageInput({ model: "google/imagen-4", prompt: "landscape", inputImages: [reference], quality: "ultra" })).toThrow(/does not support reference-image input/);
    const { input } = buildReplicateImageInput({ model: "google/imagen-4", prompt: "landscape", quality: "ultra" });
    expect(input).toMatchObject({ image_size: "2K" });
    expect(input).not.toHaveProperty("input_image");
    expect(input).not.toHaveProperty("image_input");
  });

  it("rejects reference images for text-only Recraft", () => {
    expect(() => buildReplicateImageInput({ model: "recraft-ai/recraft-v3", prompt: "poster", inputImages: [reference] })).toThrow(/does not support reference-image input/);
  });

  it("uses pixel size for Recraft and omits unsupported output format", () => {
    const { input, width, height } = buildReplicateImageInput({ model: "recraft-ai/recraft-v3", prompt: "poster", aspectRatio: "16:9", outputFormat: "webp" });
    expect(input.size).toBe(`${width}x${height}`);
    expect(input).not.toHaveProperty("aspect_ratio");
    expect(input).not.toHaveProperty("output_format");
  });

  it("locks request fields and quality mapping for every published model", () => {
    const fixtures: Array<{
      model: string;
      imageField?: "input_image" | "input_images" | "image_input";
      qualityField?: string;
      qualityValue?: string;
      sizeField?: "size";
      sizeValue?: string;
      outputFormat: boolean;
    }> = [
      { model: "google/nano-banana-pro", imageField: "image_input", qualityField: "resolution", qualityValue: "4K", outputFormat: true },
      { model: "google/nano-banana-2", imageField: "image_input", qualityField: "resolution", qualityValue: "4K", outputFormat: true },
      { model: "google/nano-banana", imageField: "image_input", outputFormat: true },
      { model: "google/imagen-4", qualityField: "image_size", qualityValue: "2K", outputFormat: true },
      { model: "black-forest-labs/flux-kontext-max", imageField: "input_image", outputFormat: true },
      { model: "black-forest-labs/flux-kontext-pro", imageField: "input_image", outputFormat: true },
      { model: "bytedance/seedream-5-lite", imageField: "image_input", qualityField: "size", qualityValue: "3K", outputFormat: true },
      { model: "bytedance/seedream-4.5", imageField: "image_input", qualityField: "size", qualityValue: "4K", outputFormat: false },
      { model: "bytedance/seedream-4", imageField: "image_input", qualityField: "size", qualityValue: "4K", outputFormat: false },
      { model: "recraft-ai/recraft-v3", sizeField: "size", sizeValue: "1024x576", outputFormat: false },
    ];
    expect(new ReplicateImageProvider("token").models.map(({ id }) => id).sort()).toEqual(fixtures.map(({ model }) => model).sort());

    for (const fixture of fixtures) {
      const { input } = buildReplicateImageInput({
        model: fixture.model,
        prompt: "fixture",
        aspectRatio: fixture.model === "recraft-ai/recraft-v3" ? "16:9" : "1:1",
        ...(fixture.imageField ? { inputImages: [reference] } : {}),
        quality: "ultra",
        outputFormat: "webp",
      });
      if (fixture.imageField) {
        expect(input[fixture.imageField], fixture.model).toEqual(fixture.imageField === "input_image" ? reference : [reference]);
      } else {
        expect(input, fixture.model).not.toHaveProperty("input_image");
        expect(input, fixture.model).not.toHaveProperty("input_images");
        expect(input, fixture.model).not.toHaveProperty("image_input");
      }
      if (fixture.qualityField) expect(input[fixture.qualityField], fixture.model).toBe(fixture.qualityValue);
      else {
        expect(input, fixture.model).not.toHaveProperty("resolution");
        expect(input, fixture.model).not.toHaveProperty("image_size");
        if (!fixture.sizeField) expect(input, fixture.model).not.toHaveProperty("size");
      }
      if (fixture.sizeField) expect(input[fixture.sizeField], fixture.model).toBe(fixture.sizeValue);
      expect(Boolean(input.output_format), fixture.model).toBe(fixture.outputFormat);
      expect(getModelCallProfile(fixture.model, "replicate").requestAdapter).toContain("replicate-model-input:");
    }
  });
});
