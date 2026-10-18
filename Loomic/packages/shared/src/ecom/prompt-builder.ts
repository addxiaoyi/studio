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
  ConversionDriver,
  EcomPrompt,
  EcomGenerationMode,
  EcomFidelity,
  EcomSceneTemplate,
  SceneVariant,
  EcomSceneTemplate as Template,
} from "./index.js";
import { HERO_SEQUENCES, IRON_RULES } from "./index.js";

export interface BuildPromptInput {
  /** The matched scene template. */
  template: EcomSceneTemplate;
  /** Product name (e.g. "Midea Air Purifier"). */
  productName: string;
  /** Optional longer description. */
  productDescription?: string | undefined;
  /** Optional user instruction that must be preserved in the final prompt. */
  customPrompt?: string | undefined;
  /** Style variant override; defaults to template.variants.default. */
  variant?: SceneVariant | undefined;
  /** Optional campaign style lock (multi-image consistency). */
  styleLock?: CampaignStyleLock | undefined;
  /** Override aspect ratio; defaults to template.defaultRatio. */
  ratio?: EcomSceneTemplate["defaultRatio"] | undefined;
  /** Purpose of this specific image (e.g. "hero", "benefit-1", "cta"). */
  purpose?: string | undefined;
  /** A user-supplied image is the source of truth for the product identity. */
  hasReferenceImage?: boolean | undefined;
  mode?: EcomGenerationMode | undefined;
  fidelity?: EcomFidelity | undefined;
}

const MODE_DIRECTIONS: Record<EcomGenerationMode, string> = {
  hero: "Create a focused ecommerce hero image with one clear product presentation, restrained styling, and purposeful whitespace.",
  scene: "Create a natural lifestyle product photograph with believable human context, layered depth, candid details, and physically plausible interaction.",
  "detail-poster": "Create a polished vertical ecommerce detail poster with a strong editorial hierarchy and a rich but coherent visual story. Build distinct sections for the headline, real-use hero scene, key benefits, close-up evidence, product variants, and packaging. Use varied scale, overlapping paper or photo layers, small supporting illustrations, and intentional visual rhythm. The result must feel art-directed, premium, natural, and information-rich rather than sparse or template-like. Repeating the product in different detail views is allowed when it explains features. Keep Chinese copy concise, legible, and faithful to supplied facts; omit uncertain claims instead of inventing them.",
  social: "Create an authentic social-commerce image with an immediate visual hook, natural light, lived-in details, concise readable copy, and a clear but non-intrusive call to action.",
  retouch: "Perform a conservative photographic retouch. Preserve the original composition and product pixels while improving exposure, color balance, clarity, background cleanliness, and material realism.",
};

const FIDELITY_DIRECTIONS: Record<EcomFidelity, string> = {
  strict: "STRICT FIDELITY: preserve product artwork, printed text, logo, shape, materials, colors, count, and packaging exactly. Do not redraw the product. Compose with faithful views from the references.",
  balanced: "BALANCED FIDELITY: preserve identity, artwork, text, shape, colors, and packaging; camera angle and lighting may change naturally.",
  creative: "CREATIVE FIDELITY: preserve brand and product category, but allow broader art direction and presentation changes requested by the user.",
};

function detailPosterBlueprint(input: BuildPromptInput): string {
  const facts = input.productDescription?.trim()
    ? `Verified product facts: ${input.productDescription.trim()}`
    : "No verified selling points were supplied. Use visual descriptions only and do not invent claims.";
  const direction = input.customPrompt?.trim()
    ? `USER'S PRIMARY CREATIVE DIRECTION: ${input.customPrompt.trim()}`
    : "Art direction: natural daylight, warm tactile materials, candid use, and polished editorial photography.";

  return `${direction}
Create one cohesive, premium vertical 2:3 Chinese ecommerce poster for ${input.productName}. Treat the references as visual source material and art-direct the entire image yourself: naturally integrate the real product, lifestyle environment, supporting details, decorative elements, and concise copy into one believable image. Use a clear visual hierarchy, varied scale, natural photographic lighting, authentic materials, coherent perspective, and organic transitions between image areas. Make it feel like a professionally art-directed campaign, not a collage assembled from separate crops or a rigid grid.
${facts}
Keep product artwork, readable labels, colors, shape, and distinctive details faithful to the references. You may show multiple product views only when they integrate naturally. Use only supplied or visually verifiable facts; do not invent benefits, certifications, prices, reviews, or claims. Let the model choose the precise layout and visual rhythm. Avoid fixed section percentages, pasted-on overlays, boxed UI cards, repeated tiled crops, awkwardly embedded duplicate objects, huge blank areas, and sterile stock compositions.`;
}

/**
 * Build the final prompt for a single image, substituting the product name,
 * applying the variant overlay, and prefixing the campaign style lock
 * (if provided).
 */
export function buildPrompt(input: BuildPromptInput): EcomPrompt {
  const { template } = input;
  const mode = input.mode ?? "hero";
  const fidelity = input.fidelity ?? "strict";
  const variant = input.variant ?? "default";
  let body = template.promptTemplate
    .replace(/\{\{product\}\}/g, input.productName)
    .replace(
      /\{\{product_description\}\}/g,
      input.productDescription ?? input.productName,
    );

  if (mode === "detail-poster") body = detailPosterBlueprint(input);

  // Apply the variant overlay if available
  const variantOverlay = template.variants[variant];
  if (variantOverlay) {
    body = `${body} ${variantOverlay}`;
  }

  // Prefix the campaign style lock — every multi-image set needs an identical
  // opening paragraph for visual consistency.
  let prefix = "";
  if (input.styleLock) {
    prefix = `${formatStyleLock(input.styleLock)} `;
  }

  // Add the purpose if provided (e.g. "benefit-1", "pain-amplification").
  if (input.purpose) {
    body = `${body} Purpose: ${input.purpose}.`;
  }

  if (mode !== "detail-poster" && input.customPrompt?.trim()) {
    body = `USER'S PRIMARY CREATIVE DIRECTION — User direction: ${input.customPrompt.trim()} Supporting scene guidance: ${body}`;
  }

  const referenceAnchor = input.hasReferenceImage
    ? `IMAGE 1 IS THE ONLY SOURCE OF TRUTH FOR PRODUCT IDENTITY. This is a product-preserving composition, not a product redesign. Preserve its artwork, silhouette, geometry, proportions, colors, materials, texture, typography, readable text, logo, edges, and visual hierarchy. A logo or flat graphic must remain that exact logo or flat graphic. ${mode === "detail-poster" ? "The same faithful product may appear in multiple panels or views; every appearance must preserve the reference identity." : "Keep one exact product instance unless the user explicitly requests multiple views."} Do not reinterpret, redesign, rebrand, redraw, rename, replace, reshape, or convert it into another object. If scene guidance conflicts with product identity, preserve the product and adapt the scene around it. `
    : "";

  const compositionRules = mode === "detail-poster"
    ? "Let the image model make an organic full-canvas composition with natural transitions and consistent perspective; do not manually tile or paste reference images."
    : mode === "retouch"
      ? "Do not add promotional copy, badges, props, or new product instances unless explicitly requested."
      : "Product occupies 30-45% of frame with clean breathing room and a deliberate focal point.";

  return {
    sceneId: template.id,
    text: `${mode === "detail-poster" ? `${body} ${referenceAnchor}` : `${referenceAnchor}${prefix}${body}`} ${FIDELITY_DIRECTIONS[fidelity]} ${MODE_DIRECTIONS[mode]} ${compositionRules} Use physically plausible lighting, contact shadows, reflections, perspective, hands, and material texture. Preserve the exact product identity, silhouette, proportions, materials, colors, labels, logo placement, and packaging from the references. Do not invent specifications, certifications, prices, reviews, endorsements, accessories, brand marks, packaging text, or product features. No unresolved template placeholders, watermarks, malformed text, distorted geometry, floating objects, extra limbs, or accidental clutter.`.trim(),
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

import { PDP_BACKGROUNDS, PDP_DETAIL_SEQUENCE } from "./index.js";

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
  return `Consistent premium ecommerce visual system. Fixed palette: ${palette}, accent ${lock.accent}. Color temperature: ${lock.colorTemperature}. Light direction: ${lock.lightDirection}. Font system: ${lock.fontSystem}. Background: ${lock.background}. Layout: ${lock.layout}. Icon style: ${lock.iconStyle}. Product rules: ${lock.productRules}. Forbidden: ${lock.forbiddenDrift.join(", ")}.`;
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
      productRules: "occupies 35% of frame, sharp, mid-action when applicable",
      forbiddenDrift: ["no fake data charts", "no aggressive health claims"],
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
    forbiddenDrift: ["no clutter", "no fake endorsement text"],
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
  if (
    !/no\s+(hands|logos|watermarks|props|text|gradients|fake)/i.test(prompt)
  ) {
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
  if (wsMatch?.[2]) {
    const pct = Number.parseInt(wsMatch[2], 10);
    if (!Number.isNaN(pct) && pct < IRON_RULES.minWhitespace * 100) {
      violations.push(
        `Whitespace must be at least ${IRON_RULES.minWhitespace * 100}%.`,
      );
    }
  }

  return violations;
}
