// @ecom-image — Core types for e-commerce image generation
// Mirrors the structure of the ecom-details-image skill.

export type SceneId =
  | "01-hero-image"
  | "02-lifestyle-scene"
  | "03-flat-lay"
  | "04-detail-macro"
  | "05-poster-banner"
  | "06-social-media"
  | "07-ugc-style"
  | "08-model-showcase"
  | "09-before-after"
  | "10-packaging"
  | "11-infographic"
  | "12-creative-concept"
  | "13-size-spec"
  | "14-multi-product"
  | "15-livestream"
  | "16-try-on-virtual"
  | "17-exploded-view"
  | "18-ghost-mannequin"
  | "19-multi-angle-grid"
  | "20-magazine-editorial"
  | "21-seasonal-campaign"
  | "22-luxury-atmospherics"
  | "23-device-mockup"
  | "24-storefront"
  | "25-sports-campaign";

/** Visual style variant applied to the prompt. */
export type SceneVariant = "luxury" | "minimal" | "fresh" | "tech" | "default";

/** Conversion driver diagnosis. */
export type ConversionDriver = "visual" | "pain-point" | "emotional";

/** Supported aspect ratios. */
export type EcomRatio =
  | "1:1"
  | "3:2"
  | "2:3"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "16:9"
  | "9:16"
  | "21:9"
  | "9:21"
  | "2:1"
  | "1:2"
  | "auto";

/** Job status. */
export type EcomJobStatus = "pending" | "running" | "succeeded" | "failed";

/** A single template describing a scene + its prompt structure. */
export interface EcomSceneTemplate {
  /** Stable kebab-case id, e.g. "01-hero-image". */
  id: SceneId;
  /** Human-readable English name. */
  name: string;
  /** Chinese name. */
  nameZh: string;
  /** Trigger keywords used by the router. */
  triggers: string[];
  /** Short description (1-2 lines). */
  description: string;
  /** Recommended default aspect ratio for the image. */
  defaultRatio: EcomRatio;
  /** Body of the prompt template (placeholders use {{name}}). */
  promptTemplate: string;
  /** Per-variant overlays. */
  variants: Partial<Record<SceneVariant, string>>;
  /** Negative constraints (what to avoid). */
  negativeConstraints: string[];
  /** Anti-AI tips — extra guidance to keep the result realistic. */
  antiAiTips: string[];
  /** Category-specific tips (apparel, beauty, 3C, food, ...). */
  categoryTips: string[];
}

/** Final assembled prompt + metadata after template substitution. */
export interface EcomPrompt {
  /** Scene id used. */
  sceneId: SceneId;
  /** The fully assembled English prompt. */
  text: string;
  /** Negative constraints (always returned alongside the prompt). */
  negatives: string[];
  /** Resolved aspect ratio. */
  ratio: EcomSceneTemplate["defaultRatio"];
  /** Optional campaign style lock applied. */
  styleLock?: CampaignStyleLock | undefined;
}

/** Campaign style lock — applied to multi-image sets to enforce consistency. */
export interface CampaignStyleLock {
  /** 2-3 brand colors in hex, plus an accent. */
  palette: string[];
  /** Accent color in hex. */
  accent: string;
  /** Color temperature, e.g. "warm 3500K" or "cool 6500K". */
  colorTemperature: string;
  /** Light direction, e.g. "45-degree top-left". */
  lightDirection: string;
  /** Font system, e.g. "modern sans-serif" or "inter / source han sans". */
  fontSystem: string;
  /** Background color or pattern. */
  background: string | undefined;
  /** Layout style, e.g. "centered" or "rule-of-thirds". */
  layout: string;
  /** Icon style, e.g. "filled flat" or "outline 1.5px". */
  iconStyle: string;
  /** Free-text rules for product depiction. */
  productRules: string;
  /** Forbidden drift items. */
  forbiddenDrift: string[];
}

/** Conversion driver diagnosis — analysis used to inform the prompt. */
export interface ConversionDiagnosis {
  driver: ConversionDriver;
  /** Confidence 0-1. */
  confidence: number;
  /** Reasoning shown to the user. */
  rationale: string;
  /** 5-item hero sequence template, e.g. ["claim", "feature", "scene", "comparison", "cta"]. */
  heroSequence: string[];
}

/** Job in flight. Persisted server-side, polled by the client. */
export interface EcomJob {
  id: string;
  workspaceId: string;
  userId: string;
  sceneId: SceneId;
  productName: string;
  productDescription?: string | undefined;
  prompt: string;
  ratio: EcomSceneTemplate["defaultRatio"];
  referenceImageUrl?: string | undefined;
  status: EcomJobStatus;
  imageUrl?: string | undefined;
  errorMessage?: string | undefined;
  creditsCharged: number;
  createdAt: number;
  completedAt?: number | undefined;
}

/** Iron rules for GPT-Image-2 (and similar) prompt writing. */
export const IRON_RULES = {
  /** Product must occupy a specific % of the frame. */
  productSizeByPurpose: {
    hero: 0.4,
    benefit: 0.28,
    lifestyle: 0.22,
    feedAd: 0.4,
    search: 0.45,
    sku: 0.65,
  },
  /** Required minimum whitespace in the image. */
  minWhitespace: 0.45,
  /** Reserved zones (no text/logo in this region). */
  reservedZones: {
    topCenterPrice: "top center 200x100",
    topLeftLogo: "top-left 200x100",
  },
  /** Text limits per hierarchy level. */
  textLimits: {
    headline: 15,
    evidenceItem: 25,
    cta: 8,
  },
} as const;

/** Default 5-image hero sequence by conversion driver. */
export const HERO_SEQUENCES: Record<ConversionDriver, string[]> = {
  visual: ["claim", "feature", "scene", "comparison", "offer-cta"],
  "pain-point": [
    "problem",
    "mechanism",
    "proof",
    "trust",
    "offer-urgency",
  ],
  emotional: [
    "hook",
    "identity",
    "product",
    "status",
    "offer-emotion",
  ],
};

/** 9-screen PDP detail sequence (2:3 vertical). */
export const PDP_DETAIL_SEQUENCE: string[] = [
  "continuation",
  "pain-amplification",
  "mechanism",
  "core-benefits",
  "usage-steps",
  "scenario-coverage",
  "comparison",
  "trust-proof",
  "faq-cta",
];

/** Common backgrounds to rotate through detail page (avoid fatigue). */
export const PDP_BACKGROUNDS = ["#FFFFFF", "#F5F1E8", "#1A3A2E"] as const;

/** Supported aspect ratios (GPT-Image-2 + apimart.ai async API). */
export const SUPPORTED_RATIOS = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const;
