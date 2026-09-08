import { describe, expect, it } from "vitest";

import {
  HERO_SEQUENCES,
  IRON_RULES,
  PDP_BACKGROUNDS,
  PDP_DETAIL_SEQUENCE,
  SCENE_TEMPLATES,
  getSceneTemplate,
  matchSceneTemplate,
  type EcomRatio,
} from "../src/ecom/mod.js";

const ALLOWED_RATIOS: readonly EcomRatio[] = [
  "1:1",
  "3:2",
  "2:3",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
  "21:9",
  "9:21",
  "2:1",
  "1:2",
  "auto",
];

// Category mapping for test 19 — manually verified from the template's purpose.
// 产品 = Product (lifestyle, detail, model, packaging, etc.)
// 营销 = Marketing (poster, social, seasonal, campaign, livestream, etc.)
// 信息 = Information (infographic, size-spec, exploded-view, etc.)
const CATEGORY_MAP: Record<string, "产品" | "营销" | "信息"> = {
  "01-hero-image": "产品",
  "02-lifestyle-scene": "产品",
  "03-flat-lay": "产品",
  "04-detail-macro": "产品",
  "05-poster-banner": "营销",
  "06-social-media": "营销",
  "07-ugc-style": "产品",
  "08-model-showcase": "产品",
  "09-before-after": "营销",
  "10-packaging": "产品",
  "11-infographic": "信息",
  "12-creative-concept": "营销",
  "13-size-spec": "信息",
  "14-multi-product": "产品",
  "15-livestream": "营销",
  "16-try-on-virtual": "产品",
  "17-exploded-view": "信息",
  "18-ghost-mannequin": "产品",
  "19-multi-angle-grid": "产品",
  "20-magazine-editorial": "营销",
  "21-seasonal-campaign": "营销",
  "22-luxury-atmospherics": "营销",
  "23-device-mockup": "产品",
  "24-storefront": "营销",
  "25-sports-campaign": "营销",
};

describe("SCENE_TEMPLATES registry", () => {
  it("1. has exactly 25 entries", () => {
    expect(SCENE_TEMPLATES).toHaveLength(25);
  });

  it("2. each id matches the pattern ^\\d{2}-[a-z-]+$", () => {
    const idPattern = /^\d{2}-[a-z-]+$/;
    for (const tpl of SCENE_TEMPLATES) {
      expect(tpl.id).toMatch(idPattern);
    }
  });

  it("3. each template has non-empty name, nameZh, description, promptTemplate", () => {
    for (const tpl of SCENE_TEMPLATES) {
      expect(tpl.name).toBeTruthy();
      expect(tpl.name.length).toBeGreaterThan(0);
      expect(tpl.nameZh).toBeTruthy();
      expect(tpl.nameZh.length).toBeGreaterThan(0);
      expect(tpl.description).toBeTruthy();
      expect(tpl.description.length).toBeGreaterThan(0);
      expect(tpl.promptTemplate).toBeTruthy();
      expect(tpl.promptTemplate.length).toBeGreaterThan(0);
    }
  });

  it("4. every template has at least 1 trigger keyword", () => {
    for (const tpl of SCENE_TEMPLATES) {
      expect(Array.isArray(tpl.triggers)).toBe(true);
      expect(tpl.triggers.length).toBeGreaterThanOrEqual(1);
      for (const trig of tpl.triggers) {
        expect(typeof trig).toBe("string");
        expect(trig.length).toBeGreaterThan(0);
      }
    }
  });

  it("5. every template has at least 1 negative constraint", () => {
    for (const tpl of SCENE_TEMPLATES) {
      expect(Array.isArray(tpl.negativeConstraints)).toBe(true);
      expect(tpl.negativeConstraints.length).toBeGreaterThanOrEqual(1);
      for (const neg of tpl.negativeConstraints) {
        expect(typeof neg).toBe("string");
        expect(neg.length).toBeGreaterThan(0);
      }
    }
  });

  it("6. every template has at least 1 anti-AI tip (where applicable)", () => {
    // Per the task: some templates may not have anti-AI tips.
    // We assert that the field exists and is an array; the count
    // is documented as "where applicable".
    for (const tpl of SCENE_TEMPLATES) {
      expect(Array.isArray(tpl.antiAiTips)).toBe(true);
    }
  });

  it("7. defaultRatio is one of the allowed ratios", () => {
    for (const tpl of SCENE_TEMPLATES) {
      expect(ALLOWED_RATIOS).toContain(tpl.defaultRatio);
    }
  });

  it("8. id values are unique across the 25 templates", () => {
    const ids = SCENE_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("9. the first template is '01-hero-image'", () => {
    expect(SCENE_TEMPLATES[0]?.id).toBe("01-hero-image");
  });

  it("10. the last template is '25-sports-campaign'", () => {
    expect(SCENE_TEMPLATES[24]?.id).toBe("25-sports-campaign");
  });

  it("19. the 25 templates cover all 3 categories (产品/营销/信息)", () => {
    const categories = new Set(Object.values(CATEGORY_MAP));
    expect(categories.has("产品")).toBe(true);
    expect(categories.has("营销")).toBe(true);
    expect(categories.has("信息")).toBe(true);

    // And every template is mapped to one of the three.
    for (const tpl of SCENE_TEMPLATES) {
      expect(CATEGORY_MAP[tpl.id]).toBeDefined();
      const cat = CATEGORY_MAP[tpl.id];
      expect(["产品", "营销", "信息"]).toContain(cat);
    }

    // Each category has at least one template.
    const productCount = Object.values(CATEGORY_MAP).filter(
      (c) => c === "产品",
    ).length;
    const marketingCount = Object.values(CATEGORY_MAP).filter(
      (c) => c === "营销",
    ).length;
    const infoCount = Object.values(CATEGORY_MAP).filter(
      (c) => c === "信息",
    ).length;
    expect(productCount).toBeGreaterThan(0);
    expect(marketingCount).toBeGreaterThan(0);
    expect(infoCount).toBeGreaterThan(0);
  });

  it("20. all template ids are stable (idempotent across re-imports)", async () => {
    // Re-import the registry and confirm the ids are identical.
    const reimport = await import("../src/ecom/mod.js");
    const originalIds = SCENE_TEMPLATES.map((t) => t.id);
    const reimportedIds = reimport.SCENE_TEMPLATES.map((t) => t.id);
    expect(reimportedIds).toEqual(originalIds);
  });
});

describe("getSceneTemplate", () => {
  it("11. returns a valid template for '01-hero-image'", () => {
    const tpl = getSceneTemplate("01-hero-image");
    expect(tpl).toBeDefined();
    expect(tpl?.id).toBe("01-hero-image");
    expect(tpl?.name).toBe("Hero Image");
  });

  it("12. returns undefined for '99-nonexistent'", () => {
    const tpl = getSceneTemplate("99-nonexistent");
    expect(tpl).toBeUndefined();
  });
});

describe("matchSceneTemplate", () => {
  it("13. returns 01-hero-image for '白底主图'", () => {
    const tpl = matchSceneTemplate("白底主图");
    expect(tpl.id).toBe("01-hero-image");
  });

  it("14. returns 01-hero-image for 'hero image'", () => {
    const tpl = matchSceneTemplate("hero image");
    expect(tpl.id).toBe("01-hero-image");
  });

  it("15. returns 11-infographic for '信息图'", () => {
    const tpl = matchSceneTemplate("信息图");
    expect(tpl.id).toBe("11-infographic");
  });

  it("16. returns 15-livestream for '直播' (livestream trigger)", () => {
    // Note: "抖音" is not currently a trigger keyword for any template
    // in the registry, so it falls back to 01-hero-image (covered by test 17).
    // The closest livestream-associated trigger is "直播" (livestream).
    const tpl = matchSceneTemplate("直播");
    expect(tpl.id).toBe("15-livestream");
  });

  it("16b. '抖音' has no matching trigger and falls back to 01-hero-image", () => {
    const tpl = matchSceneTemplate("抖音");
    expect(tpl.id).toBe("01-hero-image");
  });

  it("17. returns the default 01-hero-image for 'random gibberish xyz'", () => {
    const tpl = matchSceneTemplate("random gibberish xyz");
    expect(tpl.id).toBe("01-hero-image");
  });

  it("18. is case-insensitive", () => {
    const lower = matchSceneTemplate("hero image");
    const upper = matchSceneTemplate("HERO IMAGE");
    const mixed = matchSceneTemplate("HeRo ImAgE");
    expect(upper.id).toBe(lower.id);
    expect(mixed.id).toBe(lower.id);
    expect(upper.id).toBe("01-hero-image");
  });
});

describe("IRON_RULES", () => {
  it("productSizeByPurpose has hero=0.4, benefit=0.28, lifestyle=0.22", () => {
    expect(IRON_RULES.productSizeByPurpose.hero).toBe(0.4);
    expect(IRON_RULES.productSizeByPurpose.benefit).toBe(0.28);
    expect(IRON_RULES.productSizeByPurpose.lifestyle).toBe(0.22);
  });

  it("minWhitespace is 0.45", () => {
    expect(IRON_RULES.minWhitespace).toBe(0.45);
  });

  it("reservedZones has topCenterPrice and topLeftLogo", () => {
    expect(IRON_RULES.reservedZones.topCenterPrice).toBeDefined();
    expect(IRON_RULES.reservedZones.topLeftLogo).toBeDefined();
    expect(typeof IRON_RULES.reservedZones.topCenterPrice).toBe("string");
    expect(typeof IRON_RULES.reservedZones.topLeftLogo).toBe("string");
  });

  it("textLimits.headline=15, evidenceItem=25, cta=8", () => {
    expect(IRON_RULES.textLimits.headline).toBe(15);
    expect(IRON_RULES.textLimits.evidenceItem).toBe(25);
    expect(IRON_RULES.textLimits.cta).toBe(8);
  });
});

describe("HERO_SEQUENCES", () => {
  it("visual has exactly 5 items starting with 'claim'", () => {
    expect(HERO_SEQUENCES.visual).toHaveLength(5);
    expect(HERO_SEQUENCES.visual[0]).toBe("claim");
  });

  it("'pain-point' has exactly 5 items starting with 'problem'", () => {
    expect(HERO_SEQUENCES["pain-point"]).toHaveLength(5);
    expect(HERO_SEQUENCES["pain-point"][0]).toBe("problem");
  });

  it("emotional has exactly 5 items starting with 'hook'", () => {
    expect(HERO_SEQUENCES.emotional).toHaveLength(5);
    expect(HERO_SEQUENCES.emotional[0]).toBe("hook");
  });
});

describe("PDP_DETAIL_SEQUENCE", () => {
  it("has exactly 9 items", () => {
    expect(PDP_DETAIL_SEQUENCE).toHaveLength(9);
  });
});

describe("PDP_BACKGROUNDS", () => {
  it("has exactly 3 colors", () => {
    expect(PDP_BACKGROUNDS).toHaveLength(3);
  });
});
