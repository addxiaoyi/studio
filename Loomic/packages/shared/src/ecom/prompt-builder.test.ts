import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt-builder.js";
import { getSceneTemplate } from "./templates.js";

describe("buildPrompt reference fidelity", () => {
  it("makes the uploaded image the source of truth", () => {
    const template = getSceneTemplate("24-storefront");
    expect(template).toBeDefined();

    const prompt = buildPrompt({
      template: template!,
      productName: "r'g'z",
      productDescription: "ef",
      hasReferenceImage: true,
    }).text;

    expect(prompt.startsWith("IMAGE 1 IS THE ONLY SOURCE OF TRUTH")).toBe(true);
    expect(prompt).toContain("A logo or flat graphic must remain that exact logo");
    expect(prompt).toContain("Do not reinterpret, redesign, rebrand");
    expect(prompt).toContain("adapt the scene around it");
  });

  it("does not add image-specific instructions to text-only generation", () => {
    const template = getSceneTemplate("01-hero-image");
    expect(template).toBeDefined();

    const prompt = buildPrompt({
      template: template!,
      productName: "Desk lamp",
    }).text;

    expect(prompt).not.toContain("IMAGE 1 IS THE ONLY SOURCE OF TRUTH");
  });

  it("preserves the user's custom direction in the final prompt", () => {
    const template = getSceneTemplate("01-hero-image");
    expect(template).toBeDefined();

    const prompt = buildPrompt({
      template: template!,
      productName: "Desk lamp",
      customPrompt: "Warm morning light, place the product beside a walnut desk.",
    }).text;

    expect(prompt).toContain(
      "User direction: Warm morning light, place the product beside a walnut desk.",
    );
  });
});

describe("buildPrompt detail poster mode", () => {
  it("uses dense editorial composition without the generic whitespace rule", () => {
    const template = getSceneTemplate("11-infographic");
    expect(template).toBeDefined();
    const prompt = buildPrompt({
      template: template!,
      productName: "东海刮画书签",
      mode: "detail-poster",
      fidelity: "strict",
      ratio: "2:3",
      hasReferenceImage: true,
    }).text;

    expect(prompt).toContain("rich but coherent visual story");
    expect(prompt).toContain("one cohesive, premium vertical 2:3");
    expect(prompt).toContain("art-direct the entire image yourself");
    expect(prompt).toContain("do not manually tile or paste reference images");
    expect(prompt).not.toContain("LAYOUT BLUEPRINT");
    expect(prompt).toContain("The same faithful product may appear in multiple panels");
    expect(prompt).not.toContain("at least 50% clean whitespace");
    expect(prompt).not.toContain("Keep one exact instance");
    expect(prompt).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
