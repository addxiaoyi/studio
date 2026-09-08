// @ecom-image — Prompt builder: turns user input into a final executable prompt
// Encapsulates the iron rules from the ecom-details-image skill:
// - Hex colors, not named
// - Numeric sizing (% of frame)
// - Explicit whitespace requirements
// - Negative constraints
// - Reserved zones
// - Campaign style lock (multi-image)

import type {
  CampaignStyleLock,
  EcomPrompt,
  EcomSceneTemplate,
  EcomSceneTemplate as Template,
  SceneVariant,
  ConversionDriver,
} from "./index.js";
import { IRON_RULES, HERO_SEQUENCES } from "./index.js";

export interface BuildPromptInput {
  /** The matched scene template. */
  template: EcomSceneTemplate;
  /** Product name (e.g. "Midea Air Purifier"). */
  productName: string;
  /** Optional longer description. */
  productDescription?: string | undefined;
  /** Style variant override; defaults to template.variants.default. */
  variant?: SceneVariant | undefined;
  /** Optional campaign style lock (multi-image consistency). */
  styleLock?: CampaignStyleLock | undefined;
  /** Override aspect ratio; defaults to template.defaultRatio. */
  ratio?: EcomSceneTemplate["defaultRatio"] | undefined;
  /** Purpose of this specific image (e.g. "hero", "benefit-1", "cta"). */
  purpose?: string | undefined;
}

/**
 * Build the final prompt for a single image, substituting the product name,
 * applying the variant overlay, and prefixing the campaign style lock
 * (if provided).
 */
export function buildPrompt(input: BuildPromptInput): EcomPrompt {
  const { template } = input;
  const variant = input.variant ?? "default";
  let body = template.promptTemplate
    .replace(/\{\{product\}\}/g, input.productName)
    .replace(
      /\{\{product_description\}\}/g,
      input.productDescription ?? input.productName,
    );

  // Apply the variant overlay if available
  const variantOverlay = template.variants[variant];
  if (variantOverlay) {
    body = `${body} ${variantOverlay}`;
  }

  // Prefix the campaign style lock — every multi-image set needs an identical
  // opening paragraph for visual consistency.
  let prefix = "";
  if (input.styleLock) {
    prefix = formatStyleLock(input.styleLock) + " ";
  }

  // Add the purpose if provided (e.g. "benefit-1", "pain-amplification").
  if (input.purpose) {
    body = `${body} Purpose: ${input.purpose}.`;
  }

  return {
    sceneId: template.id,
    text: `${prefix}${body}`.trim(),
    negatives: template.negativeConstraints,
    ratio: input.ratio ?? template.defaultRatio,
    styleLock: input.styleLock,
  };
}

/** Build a full 5-image hero pack with a consistent style lock. */
export interface HeroPackInput {
  template: Template;
  productName: string;
  productDescription?: string | undefined;
  driver: ConversionDriver;
  styleLock: CampaignStyleLock;
  ratio?: EcomSceneTemplate["defaultRatio"] | undefined;
}

export interface HeroPackImage {
  index: number;
  purpose: string;
  prompt: EcomPrompt;
}

export function buildHeroPack(input: HeroPackInput): HeroPackImage[] {
  const sequence = HERO_SEQUENCES[input.driver];
  return sequence.map((purpose, index) => ({
    index,
    purpose,
    prompt: buildPrompt({
      template: input.template,
      productName: input.productName,
      productDescription: input.productDescription,
      styleLock: input.styleLock,
      ratio: input.ratio,
      purpose: `hero ${index + 1} — ${purpose}`,
    }),
  }));
}

/** Build a 9-screen PDP detail page pack (2:3 vertical). */
export interface DetailPackInput {
  template: Template;
  productName: string;
  productDescription?: string | undefined;
  styleLock: CampaignStyleLock;
  /** Screen type — usually "infographic". */
  screenType?: string;
}

export interface DetailPackScreen {
  index: number;
  purpose: string;
  prompt: EcomPrompt;
}

import { PDP_DETAIL_SEQUENCE, PDP_BACKGROUNDS } from "./index.js";

export function buildDetailPack(input: DetailPackInput): DetailPackScreen[] {
  const screenType = input.screenType ?? "screen";
  return PDP_DETAIL_SEQUENCE.map((purpose, index) => {
    // Rotate 3 backgrounds to avoid fatigue
    const bg = PDP_BACKGROUNDS[index % PDP_BACKGROUNDS.length];
    const prompt = buildPrompt({
      template: input.template,
      productName: input.productName,
      productDescription: input.productDescription,
      styleLock: input.styleLock
        ? { ...input.styleLock, background: bg }
        : undefined,
      ratio: "2:3",
      purpose: `detail ${index + 1} — ${purpose}`,
    });
    // Substitute the screen type placeholder in the template
    prompt.text = prompt.text.replace("{{screen_type}}", screenType);
    return {
      index,
      purpose,
      prompt,
    };
  });
}

/** Format a Campaign Style Lock as a consistent opening paragraph. */
function formatStyleLock(lock: CampaignStyleLock): string {
  const palette = lock.palette.join(", ");
  return (
    `Consistent premium ecommerce visual system. ` +
    `Fixed palette: ${palette}, accent ${lock.accent}. ` +
    `Color temperature: ${lock.colorTemperature}. ` +
    `Light direction: ${lock.lightDirection}. ` +
    `Font system: ${lock.fontSystem}. ` +
    `Background: ${lock.background}. ` +
    `Layout: ${lock.layout}. ` +
    `Icon style: ${lock.iconStyle}. ` +
    `Product rules: ${lock.productRules}. ` +
    `Forbidden: ${lock.forbiddenDrift.join(", ")}.`
  );
}

/** Diagnose the conversion driver from a free-text product description. */
export function diagnoseConversionDriver(text: string): {
  driver: ConversionDriver;
  confidence: number;
  rationale: string;
} {
  const lower = text.toLowerCase();

  // Pain-point signals
  if (
    /(问题|困扰|痛点|解决|修复|治愈|problem|solve|fix|repair|cure|pain|struggle)/i.test(
      lower,
    )
  ) {
    return {
      driver: "pain-point",
      confidence: 0.7,
      rationale:
        "Detected pain-point language ('问题/解决/修复/治愈'). Drives urgency and conversion.",
    };
  }

  // Emotional signals
  if (
    /(感觉|体验|身份|自我|感受|身份认同|专属|情感|feel|experience|identity|emotion|lifestyle|belong)/i.test(
      lower,
    )
  ) {
    return {
      driver: "emotional",
      confidence: 0.7,
      rationale:
        "Detected emotional/lifestyle language. Drives brand affinity and aspirational purchase.",
    };
  }

  // Visual driver is the safe default
  return {
    driver: "visual",
    confidence: 0.5,
    rationale:
      "Default to visual driver: aesthetic and quality signals. " +
      "Use this unless the product specifically solves a problem or sells a feeling.",
  };
}

/** Returns a default style lock for a given driver / variant. */
export function defaultStyleLock(
  driver: ConversionDriver,
  variant: SceneVariant = "default",
): CampaignStyleLock {
  if (driver === "emotional" || variant === "luxury") {
    return {
      palette: ["#1A1A1A", "#F5F1E8", "#FFFFFF"],
      accent: "#D4AF37",
      colorTemperature: "warm 3500K",
      lightDirection: "45-degree top-left, soft fill from below",
      fontSystem: "thin sans-serif (Inter / Source Han Sans)",
      background: "#1A1A1A charcoal with subtle vignette",
      layout: "rule of thirds, generous negative space",
      iconStyle: "outline 1.5px stroke, monoline",
      productRules:
        "occupies 30-40% of frame, soft shadow, no harsh reflections",
      forbiddenDrift: [
        "no busy backgrounds",
        "no fake brand logos",
        "no fabricated awards or reviews",
      ],
    };
  }
  if (driver === "pain-point" || variant === "tech") {
    return {
      palette: ["#FFFFFF", "#0A2540", "#00D4FF"],
      accent: "#00D4FF",
      colorTemperature: "cool 6500K",
      lightDirection: "soft overhead, rim from behind",
      fontSystem: "modern sans-serif + monospace for spec",
      background: "#FFFFFF with subtle gradient",
      layout: "centered, diagrammatic",
      iconStyle: "filled flat 1px stroke",
      productRules:
        "occupies 35% of frame, sharp, mid-action when applicable",
      forbiddenDrift: [
        "no fake data charts",
        "no aggressive health claims",
      ],
    };
  }
  // visual + fresh + minimal → default
  return {
    palette: ["#FFFFFF", "#E6F4EA", "#1A1A1A"],
    accent: "#34C759",
    colorTemperature: "neutral 5000K",
    lightDirection: "soft daylight from a window",
    fontSystem: "modern rounded sans-serif",
    background: "#FFFFFF",
    layout: "centered with light rule-of-thirds offset",
    iconStyle: "rounded soft 2px stroke",
    productRules: "occupies 35% of frame, natural light shadow",
    forbiddenDrift: [
      "no clutter",
      "no fake endorsement text",
    ],
  };
}

/** Iron-rule validation: returns any rules the prompt violates. */
export function validateIronRules(prompt: string): string[] {
  const violations: string[] = [];

  // 1. Must contain a hex color
  if (!/#([0-9a-fA-F]{3}){1,2}\b/.test(prompt)) {
    violations.push(
      "Prompt must contain at least one hex color (e.g. #FFFFFF) per iron rules.",
    );
  }

  // 2. Must specify product size as a percentage
  if (!/\d+\s*-\s*\d+\s*%/.test(prompt) && !/\d+\s*%/.test(prompt)) {
    violations.push(
      "Prompt should specify product size as a percentage (e.g. 35-40%).",
    );
  }

  // 3. Must mention whitespace
  if (!/whitespace/i.test(prompt)) {
    violations.push(
      "Prompt should explicitly mention whitespace requirements (e.g. 'whitespace at least 50%').",
    );
  }

  // 4. Must contain negative constraints
  if (!/no\s+(hands|logos|watermarks|props|text|gradients|fake)/i.test(prompt)) {
    violations.push(
      "Prompt should include negative constraints (e.g. 'no fake logos, no watermarks').",
    );
  }

  // 5. Must mention reserved zones
  if (!/top[- ]?(left|center|right)\s+\d+/.test(prompt)) {
    violations.push(
      "Prompt should reserve text/logo zones (e.g. 'top center 200x100 fully clear').",
    );
  }

  // 6. Min whitespace threshold
  const wsMatch = prompt.match(/whitespace\s+(at\s+least\s+)?(\d+)\s*%?/i);
  if (wsMatch && wsMatch[2]) {
    const pct = Number.parseInt(wsMatch[2], 10);
    if (!Number.isNaN(pct) && pct < IRON_RULES.minWhitespace * 100) {
      violations.push(
        `Whitespace must be at least ${IRON_RULES.minWhitespace * 100}%.`,
      );
    }
  }

  return violations;
}
