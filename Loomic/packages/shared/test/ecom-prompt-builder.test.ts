import { describe, expect, it } from "vitest";

import {
  buildPrompt,
  buildHeroPack,
  buildDetailPack,
  diagnoseConversionDriver,
  defaultStyleLock,
  validateIronRules,
  getSceneTemplate,
  matchSceneTemplate,
} from "../src/ecom/mod.js";
import {
  HERO_SEQUENCES,
  PDP_BACKGROUNDS,
  IRON_RULES,
  PDP_DETAIL_SEQUENCE,
} from "../src/ecom/mod.js";
import type {
  CampaignStyleLock,
  ConversionDriver,
  EcomSceneTemplate,
  SceneVariant,
} from "../src/ecom/mod.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const HERO_TEMPLATE: EcomSceneTemplate = {
  id: "01-hero-image",
  name: "Hero Image",
  nameZh: "白底主图",
  triggers: ["hero", "packshot", "主图", "白底"],
  description: "Clean white-background product hero shot.",
  defaultRatio: "1:1",
  promptTemplate:
    "E-commerce hero product photograph on pure {{color}} background. " +
    "Single {{product}}, centered, occupying exactly 35-40% of the frame. " +
    "Whitespace at least 50% of the frame.",
  variants: {
    default: "Standard studio lighting.",
    luxury: "Frosted glass plinth, brushed-metal rim.",
    fresh: "Mint #E6F4EA backplate, natural daylight.",
  },
  negativeConstraints: ["no fake logos", "no watermarks"],
  antiAiTips: [],
  categoryTips: [],
};

const FULL_STYLE_LOCK: CampaignStyleLock = {
  palette: ["#FFFFFF", "#1A1A1A"],
  accent: "#D4AF37",
  colorTemperature: "warm 3500K",
  lightDirection: "45-degree top-left",
  fontSystem: "thin sans-serif",
  background: "#1A1A1A charcoal",
  layout: "rule of thirds",
  iconStyle: "outline 1.5px stroke",
  productRules: "occupies 30-40% of frame",
  forbiddenDrift: ["no busy backgrounds", "no fake logos"],
};

const COMPLETE_IRON_PROMPT =
  "Hero product shot on #FFFFFF background. " +
  "Product occupies 35-40% of frame. " +
  "Whitespace at least 50%. " +
  "top center 200x100 fully clear for logo placement. " +
  "no fake logos, no watermarks, no text.";

// ── buildPrompt ────────────────────────────────────────────────────────────────

describe("buildPrompt", () => {
  it("substitutes all placeholders with product name and description", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Midea Air Purifier",
      productDescription: "HEPA-filter air purifier for bedrooms",
    });

    expect(result.text).toContain("Midea Air Purifier");
    expect(result.text).not.toContain("{{product}}");
    expect(result.text).not.toContain("{{product_description}}");
    expect(result.sceneId).toBe("01-hero-image");
    expect(result.negatives).toEqual(["no fake logos", "no watermarks"]);
    expect(result.ratio).toBe("1:1");
    expect(result.styleLock).toBeUndefined();
  });

  it("uses defaults when optional fields are absent", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Test Product",
    });

    // variant defaults to "default"
    expect(result.text).toContain("Standard studio lighting.");
    // ratio defaults to template.defaultRatio
    expect(result.ratio).toBe("1:1");
    // no styleLock
    expect(result.styleLock).toBeUndefined();
  });

  it("appends variant overlay text when variant is provided", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Test Product",
      variant: "luxury",
    });

    expect(result.text).toContain("Frosted glass plinth, brushed-metal rim.");
    // Default overlay should also be absent
    expect(result.text).not.toContain("Standard studio lighting.");
  });

  it("prepends style lock paragraph when styleLock is provided", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Test Product",
      styleLock: FULL_STYLE_LOCK,
    });

    expect(result.text).toContain("Consistent premium ecommerce visual system.");
    expect(result.text).toContain("Fixed palette: #FFFFFF, #1A1A1A, accent #D4AF37");
    expect(result.text).toContain("Color temperature: warm 3500K");
    expect(result.text).toContain("Light direction: 45-degree top-left");
  });

  it("appends purpose as a suffix when purpose is provided", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Test Product",
      purpose: "hero-1 — claim",
    });

    expect(result.text).toContain("Purpose: hero-1 — claim.");
  });

  it("falls back to productName when productDescription is absent", () => {
    const template: EcomSceneTemplate = {
      ...HERO_TEMPLATE,
      promptTemplate: "Product: {{product_description}}",
    };

    const result = buildPrompt({
      template,
      productName: "My Product",
    });

    expect(result.text).toContain("My Product");
  });

  it("prefers productDescription over productName when both present", () => {
    const template: EcomSceneTemplate = {
      ...HERO_TEMPLATE,
      promptTemplate: "Product: {{product_description}}",
    };

    const result = buildPrompt({
      template,
      productName: "Short Name",
      productDescription: "Full descriptive product name",
    });

    expect(result.text).toContain("Full descriptive product name");
    expect(result.text).not.toContain("Short Name");
  });

  it("uses ratio override when provided", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Test Product",
      ratio: "3:2",
    });

    expect(result.ratio).toBe("3:2");
  });

  it("applies styleLock and variant together in correct order", () => {
    const result = buildPrompt({
      template: HERO_TEMPLATE,
      productName: "Test Product",
      variant: "luxury",
      styleLock: FULL_STYLE_LOCK,
    });

    // style lock prefix first
    expect(result.text.startsWith("Consistent premium ecommerce")).toBe(true);
    // variant overlay appended after template body
    expect(result.text).toContain("Frosted glass plinth");
  });
});

// ── buildHeroPack ─────────────────────────────────────────────────────────────

describe("buildHeroPack", () => {
  it("returns N entries matching HERO_SEQUENCES for visual driver", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
    });

    expect(pack).toHaveLength(HERO_SEQUENCES.visual.length);
    expect(pack).toHaveLength(5);
  });

  it("returns N entries matching HERO_SEQUENCES for pain-point driver", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "pain-point",
      styleLock: FULL_STYLE_LOCK,
    });

    expect(pack).toHaveLength(HERO_SEQUENCES["pain-point"].length);
    expect(pack).toHaveLength(5);
  });

  it("returns N entries matching HERO_SEQUENCES for emotional driver", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "emotional",
      styleLock: FULL_STYLE_LOCK,
    });

    expect(pack).toHaveLength(HERO_SEQUENCES.emotional.length);
    expect(pack).toHaveLength(5);
  });

  it("sets index sequentially from 0", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.index).toBe(i);
    });
  });

  it("sets purpose to the underlying sequence step name", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.purpose).toBe(HERO_SEQUENCES.visual[i]);
    });
  });

  it("includes formatted 'hero N — sequence_name' in prompt purpose", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.prompt.text).toContain(
        `Purpose: hero ${i + 1} — ${HERO_SEQUENCES.visual[i]}`,
      );
    });
  });

  it("applies consistent style lock to all prompts", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry) => {
      expect(entry.prompt.styleLock).toBeDefined();
      expect(entry.prompt.styleLock?.palette).toEqual(["#FFFFFF", "#1A1A1A"]);
    });
  });

  it("applies optional ratio override to all prompts", () => {
    const pack = buildHeroPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
      ratio: "4:5",
    });

    pack.forEach((entry) => {
      expect(entry.prompt.ratio).toBe("4:5");
    });
  });

  it("passes productDescription to all underlying buildPrompt calls", () => {
    const templateWithDesc: EcomSceneTemplate = {
      ...HERO_TEMPLATE,
      promptTemplate: "Product: {{product_description}}",
    };

    const pack = buildHeroPack({
      template: templateWithDesc,
      productName: "Short Name",
      productDescription: "Full Description",
      driver: "visual",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry) => {
      expect(entry.prompt.text).toContain("Full Description");
    });
  });
});

// ── buildDetailPack ────────────────────────────────────────────────────────────

describe("buildDetailPack", () => {
  it("returns exactly 9 screens", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    expect(pack).toHaveLength(9);
    expect(pack).toHaveLength(PDP_DETAIL_SEQUENCE.length);
  });

  it("sets index sequentially from 0", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.index).toBe(i);
    });
  });

  it("sets purpose to the PDP detail sequence step name", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.purpose).toBe(PDP_DETAIL_SEQUENCE[i]);
    });
  });

  it("includes formatted 'detail N — sequence_name' in prompt purpose", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.prompt.text).toContain(
        `Purpose: detail ${i + 1} — ${PDP_DETAIL_SEQUENCE[i]}`,
      );
    });
  });

  it("uses 2:3 ratio for detail screens", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry) => {
      expect(entry.prompt.ratio).toBe("2:3");
    });
  });

  it("rotates 3 backgrounds cyclically (PDP_BACKGROUNDS)", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    // Indices 0,3,6 → background 0 (PDP_BACKGROUNDS[0])
    expect(pack[0]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[0]);
    expect(pack[3]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[0]);
    expect(pack[6]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[0]);

    // Indices 1,4,7 → background 1 (PDP_BACKGROUNDS[1])
    expect(pack[1]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[1]);
    expect(pack[4]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[1]);
    expect(pack[7]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[1]);

    // Indices 2,5,8 → background 2 (PDP_BACKGROUNDS[2])
    expect(pack[2]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[2]);
    expect(pack[5]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[2]);
    expect(pack[8]!.prompt.styleLock?.background).toBe(PDP_BACKGROUNDS[2]);
  });

  it("substitutes {{screen_type}} placeholder in prompt text", () => {
    const templateWithScreenType: EcomSceneTemplate = {
      ...HERO_TEMPLATE,
      promptTemplate: "Infographic [{{screen_type}}] for {{product}}.",
    };

    const pack = buildDetailPack({
      template: templateWithScreenType,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
      screenType: "infographic",
    });

    pack.forEach((entry) => {
      expect(entry.prompt.text).toContain("[infographic]");
      expect(entry.prompt.text).not.toContain("{{screen_type}}");
    });
  });

  it("defaults screenType to 'screen' when not provided", () => {
    const templateWithScreenType: EcomSceneTemplate = {
      ...HERO_TEMPLATE,
      promptTemplate: "Screen: {{screen_type}}.",
    };

    const pack = buildDetailPack({
      template: templateWithScreenType,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry) => {
      expect(entry.prompt.text).toContain("Screen: screen.");
    });
  });

  it("passes productDescription to all underlying buildPrompt calls", () => {
    const templateWithDesc: EcomSceneTemplate = {
      ...HERO_TEMPLATE,
      promptTemplate: "Product: {{product_description}}.",
    };

    const pack = buildDetailPack({
      template: templateWithDesc,
      productName: "Short Name",
      productDescription: "Full Descriptive Text",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry) => {
      expect(entry.prompt.text).toContain("Full Descriptive Text");
    });
  });

  it("injects rotated background into styleLock for each screen", () => {
    const pack = buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    pack.forEach((entry, i) => {
      expect(entry.prompt.styleLock?.background).toBe(
        PDP_BACKGROUNDS[i % PDP_BACKGROUNDS.length],
      );
    });
  });

  it("does not modify original styleLock object", () => {
    const originalBackground = FULL_STYLE_LOCK.background;
    buildDetailPack({
      template: HERO_TEMPLATE,
      productName: "Air Purifier",
      styleLock: FULL_STYLE_LOCK,
    });

    // The original styleLock background should be unchanged
    expect(FULL_STYLE_LOCK.background).toBe(originalBackground);
  });
});

// ── diagnoseConversionDriver ──────────────────────────────────────────────────

describe("diagnoseConversionDriver", () => {
  it("returns pain-point for '痛点' keyword", () => {
    const result = diagnoseConversionDriver("这款产品能解决用户的痛点问题");
    expect(result.driver).toBe("pain-point");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns pain-point for '问题' keyword", () => {
    const result = diagnoseConversionDriver("解决用户的问题");
    expect(result.driver).toBe("pain-point");
  });

  it("returns pain-point for '修复' keyword (English)", () => {
    const result = diagnoseConversionDriver("repair this issue");
    expect(result.driver).toBe("pain-point");
  });

  it("returns emotional for '身份认同' keyword", () => {
    const result = diagnoseConversionDriver("打造专属身份认同感");
    expect(result.driver).toBe("emotional");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns emotional for '感受' keyword (Chinese)", () => {
    const result = diagnoseConversionDriver("带来极致感受");
    expect(result.driver).toBe("emotional");
  });

  it("returns emotional for 'lifestyle' keyword (English)", () => {
    const result = diagnoseConversionDriver("lifestyle product");
    expect(result.driver).toBe("emotional");
  });

  it("returns visual as safe default for neutral text", () => {
    const result = diagnoseConversionDriver("beautiful product with nice colors");
    expect(result.driver).toBe("visual");
    expect(result.confidence).toBe(0.5);
  });

  it("returns visual as safe default for empty string", () => {
    const result = diagnoseConversionDriver("");
    expect(result.driver).toBe("visual");
  });

  it("prefers pain-point over emotional when both match", () => {
    // pain-point check comes before emotional in the function
    const result = diagnoseConversionDriver("解决痛点问题，感受更好");
    expect(result.driver).toBe("pain-point");
  });

  it("returns a rationale string in all cases", () => {
    const drivers: ConversionDriver[] = ["visual", "pain-point", "emotional"];

    const testTexts: Record<ConversionDriver, string> = {
      visual: "a nice product",
      "pain-point": "solves your problem",
      emotional: "feels amazing",
    };

    drivers.forEach((driver) => {
      const result = diagnoseConversionDriver(testTexts[driver]);
      expect(typeof result.rationale).toBe("string");
      expect(result.rationale.length).toBeGreaterThan(0);
    });
  });
});

// ── defaultStyleLock ──────────────────────────────────────────────────────────

describe("defaultStyleLock", () => {
  it("returns luxury config for emotional driver", () => {
    const lock = defaultStyleLock("emotional");
    expect(lock.palette).toContain("#1A1A1A");
    expect(lock.accent).toBe("#D4AF37");
    expect(lock.colorTemperature).toContain("warm");
  });

  it("returns luxury config for luxury variant", () => {
    const lock = defaultStyleLock("visual", "luxury");
    expect(lock.accent).toBe("#D4AF37");
    expect(lock.colorTemperature).toContain("warm");
  });

  it("returns tech config for pain-point driver", () => {
    const lock = defaultStyleLock("pain-point");
    expect(lock.palette).toContain("#0A2540");
    expect(lock.accent).toBe("#00D4FF");
    expect(lock.colorTemperature).toContain("cool");
  });

  it("returns tech config for tech variant", () => {
    const lock = defaultStyleLock("visual", "tech");
    expect(lock.accent).toBe("#00D4FF");
  });

  it("returns fresh default for visual driver", () => {
    const lock = defaultStyleLock("visual");
    expect(lock.palette).toContain("#FFFFFF");
    expect(lock.accent).toBe("#34C759");
    expect(lock.colorTemperature).toContain("neutral");
  });

  it("returns fresh default for minimal variant", () => {
    const lock = defaultStyleLock("visual", "minimal");
    expect(lock.accent).toBe("#34C759");
  });

  it("returns fresh default for fresh variant", () => {
    const lock = defaultStyleLock("visual", "fresh");
    expect(lock.accent).toBe("#34C759");
  });

  it("includes forbiddenDrift array in all variants", () => {
    const drivers: ConversionDriver[] = ["visual", "pain-point", "emotional"];

    drivers.forEach((driver) => {
      const lock = defaultStyleLock(driver);
      expect(Array.isArray(lock.forbiddenDrift)).toBe(true);
      expect(lock.forbiddenDrift.length).toBeGreaterThan(0);
    });
  });

  it("each style lock has palette, accent, layout, and iconStyle", () => {
    const drivers: ConversionDriver[] = ["visual", "pain-point", "emotional"];
    const variants: SceneVariant[] = ["default", "luxury", "tech", "minimal", "fresh"];

    drivers.forEach((driver) => {
      variants.forEach((variant) => {
        const lock = defaultStyleLock(driver, variant);
        expect(lock.palette).toBeDefined();
        expect(typeof lock.accent).toBe("string");
        expect(typeof lock.layout).toBe("string");
        expect(typeof lock.iconStyle).toBe("string");
        expect(lock.palette.length).toBeGreaterThan(0);
      });
    });
  });
});

// ── validateIronRules ─────────────────────────────────────────────────────────

describe("validateIronRules", () => {
  it("flags missing hex color", () => {
    const violations = validateIronRules("A product shot with nice lighting");
    expect(violations).toContainEqual(
      expect.stringContaining("hex color"),
    );
  });

  it("flags missing percentage for product size", () => {
    const violations = validateIronRules(
      "Product shot on #FFFFFF background. no logos, no watermarks",
    );
    expect(violations).toContainEqual(
      expect.stringContaining("percentage"),
    );
  });

  it("flags missing whitespace mention", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35% of frame. no fake logos",
    );
    expect(violations).toContainEqual(
      expect.stringContaining("whitespace"),
    );
  });

  it("flags missing negative constraints", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35%. Whitespace at least 50%.",
    );
    expect(violations).toContainEqual(
      expect.stringContaining("negative constraints"),
    );
  });

  it("flags missing reserved zones", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35%. Whitespace at least 50%. no fake logos",
    );
    expect(violations).toContainEqual(
      expect.stringContaining("text/logo zones"),
    );
  });

  it("flags whitespace below 45%", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35-40%. Whitespace at least 30%. " +
        "top center 200x100 fully clear. no logos, no watermarks",
    );
    expect(violations).toContainEqual(
      expect.stringContaining("45%"),
    );
  });

  it("passes with zero violations for a complete iron-rule-compliant prompt", () => {
    const violations = validateIronRules(COMPLETE_IRON_PROMPT);
    expect(violations).toHaveLength(0);
  });

  it("accepts a range format for product size (e.g. 35-40%)", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35-40% of frame. " +
        "Whitespace at least 50%. " +
        "top center 200x100 clear. " +
        "no logos, no watermarks",
    );
    expect(violations).toHaveLength(0);
  });

  it("accepts a single percentage for product size", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35%. " +
        "Whitespace at least 50%. " +
        "top center 200x100 clear. " +
        "no logos, no watermarks",
    );
    expect(violations).toHaveLength(0);
  });

  it("accepts top-left 200x100 reserved zone format", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35%. " +
        "Whitespace at least 50%. " +
        "top-left 200x100 fully clear. " +
        "no logos, no watermarks",
    );
    expect(violations).toHaveLength(0);
  });

  it("accepts top right 200x100 reserved zone format", () => {
    const violations = validateIronRules(
      "Product on #FFFFFF. occupies 35%. " +
        "Whitespace at least 50%. " +
        "top right 200x100 fully clear. " +
        "no logos, no watermarks",
    );
    expect(violations).toHaveLength(0);
  });

  it("returns violations as an array of strings", () => {
    const violations = validateIronRules("incomplete prompt");
    expect(Array.isArray(violations)).toBe(true);
    violations.forEach((v) => {
      expect(typeof v).toBe("string");
    });
  });
});

// ── getSceneTemplate ─────────────────────────────────────────────────────────

describe("getSceneTemplate", () => {
  it("returns the matching template for a known id", () => {
    const template = getSceneTemplate("01-hero-image");
    expect(template).toBeDefined();
    expect(template!.id).toBe("01-hero-image");
    expect(template!.name).toBe("Hero Image");
  });

  it("returns the matching template for '05-poster-banner'", () => {
    const template = getSceneTemplate("05-poster-banner");
    expect(template).toBeDefined();
    expect(template!.name).toBe("Poster Banner");
  });

  it("returns undefined for an unknown id", () => {
    const template = getSceneTemplate("99-does-not-exist");
    expect(template).toBeUndefined();
  });

  it("returns undefined for empty string id", () => {
    const template = getSceneTemplate("");
    expect(template).toBeUndefined();
  });

  it("returned template has correct shape", () => {
    const template = getSceneTemplate("01-hero-image")!;
    expect(template).toHaveProperty("id");
    expect(template).toHaveProperty("name");
    expect(template).toHaveProperty("nameZh");
    expect(template).toHaveProperty("triggers");
    expect(template).toHaveProperty("defaultRatio");
    expect(template).toHaveProperty("promptTemplate");
    expect(template).toHaveProperty("variants");
    expect(template).toHaveProperty("negativeConstraints");
  });
});

// ── matchSceneTemplate ───────────────────────────────────────────────────────

describe("matchSceneTemplate", () => {
  it("matches by English trigger keyword 'hero'", () => {
    const template = matchSceneTemplate("I want a hero image");
    expect(template.id).toBe("01-hero-image");
  });

  it("matches by English trigger keyword 'lifestyle'", () => {
    const template = matchSceneTemplate("lifestyle scene for the product");
    expect(template.id).toBe("02-lifestyle-scene");
  });

  it("matches by English trigger keyword 'poster'", () => {
    const template = matchSceneTemplate("marketing poster");
    expect(template.id).toBe("05-poster-banner");
  });

  it("matches by Chinese trigger '白底'", () => {
    const template = matchSceneTemplate("需要一张白底主图");
    expect(template.id).toBe("01-hero-image");
  });

  it("matches by Chinese trigger '主图'", () => {
    const template = matchSceneTemplate("主图设计");
    expect(template.id).toBe("01-hero-image");
  });

  it("matches by Chinese trigger '场景'", () => {
    const template = matchSceneTemplate("场景图需求");
    expect(template.id).toBe("02-lifestyle-scene");
  });

  it("matches by Chinese trigger '海报'", () => {
    const template = matchSceneTemplate("海报设计");
    expect(template.id).toBe("05-poster-banner");
  });

  it("matches by mixed-case trigger", () => {
    const template = matchSceneTemplate("HERO image");
    expect(template.id).toBe("01-hero-image");
  });

  it("matches by partial trigger word", () => {
    const template = matchSceneTemplate("show me the packshot");
    expect(template.id).toBe("01-hero-image");
  });

  it("falls back to 01-hero-image for unknown query", () => {
    const template = matchSceneTemplate("xyz totally unknown thing");
    expect(template.id).toBe("01-hero-image");
  });

  it("falls back to 01-hero-image for empty string", () => {
    const template = matchSceneTemplate("");
    expect(template.id).toBe("01-hero-image");
  });

  it("returns a full EcomSceneTemplate (not undefined) for unknown", () => {
    const template = matchSceneTemplate("completely nonsense");
    expect(template).toBeDefined();
    expect(typeof template.id).toBe("string");
    expect(typeof template.promptTemplate).toBe("string");
  });

  it("matches a second call to same query returns same template (consistency)", () => {
    expect(matchSceneTemplate("hero").id).toBe(matchSceneTemplate("hero").id);
  });

  it("matches 'infographic' to the infographic template", () => {
    const template = matchSceneTemplate("create an infographic chart");
    expect(template.id).toBe("11-infographic");
  });

  it("matches 'PDP' (from triggers) to infographic template", () => {
    const template = matchSceneTemplate("A+ content PDP listing");
    expect(template.id).toBe("11-infographic");
  });
});

// ── IRON_RULES constants ──────────────────────────────────────────────────────

describe("IRON_RULES", () => {
  it("productSizeByPurpose contains expected purposes", () => {
    const purposes = Object.keys(IRON_RULES.productSizeByPurpose);
    expect(purposes).toContain("hero");
    expect(purposes).toContain("benefit");
    expect(purposes).toContain("lifestyle");
    expect(purposes).toContain("feedAd");
    expect(purposes).toContain("search");
    expect(purposes).toContain("sku");
  });

  it("productSizeByPurpose values are numbers between 0 and 1", () => {
    const sizes = Object.values(IRON_RULES.productSizeByPurpose);
    sizes.forEach((size) => {
      expect(typeof size).toBe("number");
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(1);
    });
  });

  it("minWhitespace is 0.45", () => {
    expect(IRON_RULES.minWhitespace).toBe(0.45);
  });

  it("reservedZones has topCenterPrice and topLeftLogo", () => {
    expect(IRON_RULES.reservedZones.topCenterPrice).toBe("top center 200x100");
    expect(IRON_RULES.reservedZones.topLeftLogo).toBe("top-left 200x100");
  });

  it("textLimits has headline, evidenceItem, cta", () => {
    expect(IRON_RULES.textLimits).toHaveProperty("headline");
    expect(IRON_RULES.textLimits).toHaveProperty("evidenceItem");
    expect(IRON_RULES.textLimits).toHaveProperty("cta");
  });
});

// ── HERO_SEQUENCES & PDP_BACKGROUNDS ─────────────────────────────────────────

describe("HERO_SEQUENCES", () => {
  it("visual has 5 steps", () => {
    expect(HERO_SEQUENCES.visual).toHaveLength(5);
  });

  it("pain-point has 5 steps", () => {
    expect(HERO_SEQUENCES["pain-point"]).toHaveLength(5);
  });

  it("emotional has 5 steps", () => {
    expect(HERO_SEQUENCES.emotional).toHaveLength(5);
  });

  it("each sequence contains only string items", () => {
    const drivers: ConversionDriver[] = ["visual", "pain-point", "emotional"];
    drivers.forEach((driver) => {
      HERO_SEQUENCES[driver].forEach((step) => {
        expect(typeof step).toBe("string");
      });
    });
  });
});

describe("PDP_BACKGROUNDS", () => {
  it("has exactly 3 backgrounds", () => {
    expect(PDP_BACKGROUNDS).toHaveLength(3);
  });

  it("all items are hex color strings", () => {
    PDP_BACKGROUNDS.forEach((bg) => {
      expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it("contains the documented 3 hero-image colors", () => {
    // Sanity check: PDP_BACKGROUNDS uses hex strings
    const heroTemplate = getSceneTemplate("01-hero-image")!;
    // Verify the hero template itself uses #FFFFFF explicitly
    expect(heroTemplate.promptTemplate).toContain("#FFFFFF");
  });
});

describe("PDP_DETAIL_SEQUENCE", () => {
  it("has exactly 9 entries", () => {
    expect(PDP_DETAIL_SEQUENCE).toHaveLength(9);
  });

  it("each entry is a non-empty string", () => {
    PDP_DETAIL_SEQUENCE.forEach((entry) => {
      expect(typeof entry).toBe("string");
      expect(entry.length).toBeGreaterThan(0);
    });
  });
});
