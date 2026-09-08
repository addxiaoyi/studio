// @ecom-image — E-commerce scene template registry
// 25 templates ported from the ecom-details-image skill.
// Each template provides the prompt skeleton + per-variant overlays.

import type { EcomSceneTemplate } from "./index.js";

export const SCENE_TEMPLATES: readonly EcomSceneTemplate[] = [
  {
    id: "01-hero-image",
    name: "Hero Image",
    nameZh: "白底主图",
    triggers: ["hero", "packshot", "主图", "白底"],
    description:
      "Clean white-background product hero shot. Use for the primary PDP image and as a style anchor for the rest of the set.",
    defaultRatio: "1:1",
    promptTemplate:
      "E-commerce hero product photograph on pure #FFFFFF background. " +
      "Single {{product}}, centered, occupying exactly 35-40% of the frame. " +
      "Soft 45-degree top-left key light, 5500K color temperature, subtle floor shadow. " +
      "Photoreal, no text, no props, no watermarks, no fake logos, no extra labels. " +
      "Top center 200x100 fully clear (price zone). Top-left 200x100 fully clear (logo zone). " +
      "Whitespace at least 50% of the frame.",
    variants: {
      luxury:
        "Frosted glass plinth, brushed-metal rim, charcoal #1A1A1A backdrop instead of pure white. Cinematic 35mm lens.",
      minimal:
        "Single soft overhead softbox, no floor shadow. Negative space dominates. Apple-store aesthetic.",
      fresh:
        "Mint #E6F4EA backplate, natural daylight, faint plant shadow for organic feel.",
    },
    negativeConstraints: [
      "no fake brand logos",
      "no fake certifications",
      "no price tags",
      "no humans (unless product is apparel)",
      "no gradients",
    ],
    antiAiTips: [
      "If the product has fabric, add the keyword 'fine weave texture' to preserve material realism.",
      "Specify the exact material (matte plastic, anodized aluminum) to avoid plastic-y default output.",
    ],
    categoryTips: [
      "For 3C (electronics): add 'matte anodized aluminum, no reflections on the screen surface'.",
      "For beauty: 'matte plastic, micro-pump visible on the cap'.",
    ],
  },

  {
    id: "02-lifestyle-scene",
    name: "Lifestyle Scene",
    nameZh: "场景图",
    triggers: ["lifestyle", "scene", "场景", "生活"],
    description:
      "Product in a real-world lifestyle context (kitchen, desk, outdoors, gym). Drives the 'this fits my life' feeling.",
    defaultRatio: "3:2",
    promptTemplate:
      "Lifestyle product photography. {{product}} on a {{surface}} in a {{setting}}. " +
      "Natural daylight from a window, warm 4000K fill. " +
      "Product occupies 20-25% of the frame, slightly off-center (rule of thirds). " +
      "Subtle lifestyle props in the background, not in focus. " +
      "No people visible. Photoreal, no text overlays, no fake logos.",
    variants: {
      luxury:
        "Marble countertop, brass hardware, late afternoon golden light, bokeh background.",
      fresh:
        "Linen tablecloth, eucalyptus sprig, diffused morning light through a sheer curtain.",
      tech:
        "Concrete desk, minimalist cable management, cool 5500K monitor glow, plant in the corner.",
    },
    negativeConstraints: [
      "no clutter",
      "no visible people",
      "no branded packaging from other companies",
    ],
    antiAiTips: [
      "Specify the time of day ('morning', 'golden hour') — model default is overcast noon.",
      "Add 'slight lens chromatic aberration on the edges' for realism.",
    ],
    categoryTips: [
      "For food/beverage: 'steam rising, condensation on the cup' to imply freshness.",
      "For skincare: 'water droplets on the bottle, not too clean' to imply hydration.",
    ],
  },

  {
    id: "03-flat-lay",
    name: "Flat Lay",
    nameZh: "平铺",
    triggers: ["flat lay", "overhead", "平铺", "俯拍"],
    description:
      "Top-down overhead shot. The product sits centered with arranged complementary props. Classic editorial feel.",
    defaultRatio: "1:1",
    promptTemplate:
      "Overhead flat lay photography, top-down 90-degree view. " +
      "{{product}} centered, with 3-5 complementary props arranged in a loose triangular composition. " +
      "Soft daylight from a north-facing window, no harsh shadows. " +
      "Background surface: {{surface}}. Color palette: {{palette}}. " +
      "No text overlays, no human hands visible, no fake logos.",
    variants: {
      luxury:
        "Carrara marble surface, brass details, editorial composition, no props over 4 items.",
      fresh:
        "Wooden cutting board, fresh herbs, linen napkin, soft daylight.",
      tech:
        "Graphite-grey desk mat, monitor stand, mechanical keyboard, plant in the corner.",
    },
    negativeConstraints: [
      "no people",
      "no hands reaching in",
      "no clutter (max 5 props)",
    ],
    antiAiTips: [
      "If the surface is wood, specify the grain direction ('horizontal grain').",
      "Add 'slight color cast from the props onto the product' for realism.",
    ],
    categoryTips: [
      "For beauty: lay product with 1-2 ingredients from the formula (e.g. flowers, herbs).",
      "For electronics: show cable + charger + product in a working arrangement.",
    ],
  },

  {
    id: "04-detail-macro",
    name: "Detail Macro",
    nameZh: "特写微距",
    triggers: ["macro", "detail", "特写", "微距"],
    description:
      "Extreme close-up of a key product feature (texture, mechanism, branding detail). Drives trust and perceived quality.",
    defaultRatio: "4:3",
    promptTemplate:
      "Macro product photograph, extreme close-up. Focus on {{feature}} of {{product}}. " +
      "Macro lens, 100mm equivalent, f/2.8. Bokeh background completely out of focus. " +
      "Studio lighting with a single soft light, 45-degree angle. " +
      "Visible material texture (e.g. woven fabric, brushed metal, glass, leather). " +
      "Photoreal, no text overlay, no human hands.",
    variants: {
      luxury:
        "Lighting with hard rim from the back to silhouette the edge. Highly detailed surface texture.",
      fresh:
        "Natural light, hint of water droplets if applicable. Soft shadows.",
      tech:
        "Cool blue rim light, precision-machined details highlighted, micro-engraving visible.",
    },
    negativeConstraints: [
      "no fake engraved text",
      "no watermarks",
      "no human fingers",
    ],
    antiAiTips: [
      "Specify 'macro sensor visible noise (ISO 400 grain)' to avoid plastic-y look.",
      "Mention 'sharp on the feature, soft elsewhere' to drive focus.",
    ],
    categoryTips: [
      "For leather: 'natural grain, slight wrinkle near the seam'.",
      "For watches: 'lume on the hands glowing faintly in low light'.",
    ],
  },

  {
    id: "05-poster-banner",
    name: "Poster Banner",
    nameZh: "海报横幅",
    triggers: ["poster", "banner", "promo", "海报"],
    description:
      "Marketing poster with bold typography and the product as hero. For ads, banners, store fronts.",
    defaultRatio: "3:2",
    promptTemplate:
      "Marketing poster. Hero product {{product}} centered or at 40% of frame. " +
      "Bold headline in {{font}} at 80-120pt, no more than 6 words. " +
      "Sub-headline in lighter weight, no more than 12 words. " +
      "CTA button (rendered as a clean rectangle) in the lower right. " +
      "Background: {{bg}}. Color palette: {{palette}}. " +
      "No fake prices, no fake endorsements.",
    variants: {
      luxury:
        "Gold (#D4AF37) accent on charcoal (#1A1A1A). Thin sans-serif font. Generous negative space.",
      fresh:
        "Soft pastel backdrop, friendly rounded sans-serif, mint accent. Approachable tone.",
      tech:
        "Deep blue (#0A2540) backdrop, neon cyan accent, mono-spaced subhead. Sci-fi tone.",
    },
    negativeConstraints: [
      "no fake sales data",
      "no fake awards",
      "no AI-generated text in image (will look wrong)",
    ],
    antiAiTips: [
      "Keep text short — AI image models mangle long Chinese/English text. Use the safe area for big text and edit in post.",
      "Specify font weight contrast: 'display weight 800, body weight 400'.",
    ],
    categoryTips: [
      "For beauty: 'porcelain skin tone, soft glow around the product'.",
      "For sports: 'diagonal energy lines, motion blur at the edges'.",
    ],
  },

  {
    id: "06-social-media",
    name: "Social Media",
    nameZh: "小红书 / Instagram",
    triggers: ["social", "Instagram", "XHS", "小红书", "社媒"],
    description:
      "Vertical social-media post. CardLayout optimized for feed scrolling. Light on text, heavy on emotion.",
    defaultRatio: "4:5",
    promptTemplate:
      "Vertical social media post, 4:5 aspect ratio. " +
      "{{product}} as the hero, 30-40% of frame, slightly off-center. " +
      "Casual lifestyle background (cafe table, plant, soft daylight). " +
      "Optional 3-5 word text overlay in the lower third — keep it short. " +
      "Color: warm, friendly, approachable. " +
      "Photoreal, looks like a real iPhone photo, not a studio shot.",
    variants: {
      luxury:
        "Flat-lay on marble, gold cutlery, single stem flower, soft morning light.",
      fresh:
        "Linen napkin, plant in the background, casual hand reaching in, golden hour.",
      tech:
        "Modern desk, monitor glow, plant, coffee cup, warm-cool contrast.",
    },
    negativeConstraints: [
      "no visible iPhone (avoids AI artifacts)",
      "no fake likes/comments overlay",
      "no human faces (avoid uncanny valley)",
    ],
    antiAiTips: [
      "Specify 'Slight grain (ISO 800) to mimic phone photo, not studio clean'.",
      "Add 'softly vignetted corners' for feed feel.",
    ],
    categoryTips: [
      "For beauty: 'water droplets, post-shower vibe'.",
      "For food: 'half-eaten, mid-meal authentic feel'.",
    ],
  },

  // ── Stub templates for remaining 19 scenes ──
  // Each follows the same shape; the SKILL.md describes when to use them.
  // These will be filled in iteratively as needed.

  {
    id: "07-ugc-style",
    name: "UGC Style",
    nameZh: "用户晒单",
    triggers: ["ugc", "buyer photo", "用户晒单", "买家秀"],
    description: "Authentic user-generated-content style. Casual phone photo feel.",
    defaultRatio: "4:5",
    promptTemplate:
      "Authentic UGC photo, looks like a real iPhone shot. {{product}} in everyday use, slight clutter, warm tungsten 3200K light. Subject hand visible but unposed. No text overlays, no studio lighting cues.",
    variants: {},
    negativeConstraints: ["no studio backdrop", "no perfect symmetry", "no fake reviews"],
    antiAiTips: ["Add 'slight motion blur, ISO 800 grain' for authenticity."],
    categoryTips: [],
  },
  {
    id: "08-model-showcase",
    name: "Model Showcase",
    nameZh: "模特上身",
    triggers: ["model", "模特", "真人"],
    description: "Human model wearing or holding the product. Apparel, accessories, beauty.",
    defaultRatio: "3:4",
    promptTemplate:
      "Editorial fashion photograph. {{model_description}} wearing/holding {{product}}. " +
      "Studio softbox, neutral gray #6B7280 backdrop. Three-quarter view. " +
      "Natural skin texture, no AI smoothing. Photoreal.",
    variants: {},
    negativeConstraints: ["no AI face smoothing", "no uncanny valley", "no fake brand logos on clothing"],
    antiAiTips: ["Specify ethnicity + age range to avoid generic face."],
    categoryTips: [],
  },
  {
    id: "09-before-after",
    name: "Before / After",
    nameZh: "对比",
    triggers: ["before after", "对比"],
    description: "Two-panel before/after comparison. Drives conversion for transformation products.",
    defaultRatio: "16:9",
    promptTemplate:
      "Two-panel comparison image. Left panel: 'before' state with {{product}} absent. Right panel: 'after' state with {{product}} present. " +
      "Same lighting and camera angle in both panels. Subtle divider line. " +
      "Optional small labels 'Before' / 'After' in bottom corners.",
    variants: {},
    negativeConstraints: ["no fake medical claims", "no dramatic skin retouching"],
    antiAiTips: ["Keep camera angle identical across panels."],
    categoryTips: [],
  },
  {
    id: "10-packaging",
    name: "Packaging",
    nameZh: "包装",
    triggers: ["packaging", "gift box", "包装", "开箱"],
    description: "Unboxing shot. Product with all packaging materials visible.",
    defaultRatio: "4:3",
    promptTemplate:
      "Unboxing product photography. {{product}} centered with all packaging elements (outer box, inner tray, manual, accessories) arranged around it. " +
      "Top-down 60-degree angle. Soft daylight, no harsh shadows. " +
      "Background: matte paper, white or pastel.",
    variants: {},
    negativeConstraints: ["no plastic wrap glare", "no fake brand logos"],
    antiAiTips: ["Specify paper material ('Kraft paper, recycled' for premium feel)."],
    categoryTips: [],
  },
  {
    id: "11-infographic",
    name: "Infographic",
    nameZh: "信息图",
    triggers: ["infographic", "信息图", "A+", "PDP"],
    description: "E-commerce infographic with layout, icons, labels, CTA placeholder. Drives the PDP detail page.",
    defaultRatio: "2:3",
    promptTemplate:
      "E-commerce infographic [{{screen_type}}] for {{product}}. " +
      "Vertical 2:3 layout. Hero headline at top (max 15 characters). " +
      "3 evidence rows with icons and short captions. " +
      "Sub-headline and CTA placeholder at bottom. " +
      "Background: {{bg}}. Color palette: {{palette}}. " +
      "Icons: {{icon_style}}. Whitespace ≥ 30%.",
    variants: {},
    negativeConstraints: ["no fake certifications", "no fake reviews", "no AI-rendered text (will look wrong)"],
    antiAiTips: ["Generate with empty text placeholders; overlay real text in post."],
    categoryTips: [],
  },
  {
    id: "12-creative-concept",
    name: "Creative Concept",
    nameZh: "创意概念",
    triggers: ["creative", "concept", "概念"],
    description: "Artistic / surreal concept. For brand campaigns, hero statements.",
    defaultRatio: "16:9",
    promptTemplate:
      "Creative concept art for {{product}}. {{concept_description}}. " +
      "Cinematic 35mm lens, dramatic 3-point lighting. " +
      "Concept-driven, not product-catalog. Photoreal or high-end 3D render.",
    variants: {},
    negativeConstraints: ["no generic stock imagery", "no AI face artifacts"],
    antiAiTips: ["Reference specific art direction ('in the style of a 2024 Apple keynote')."],
    categoryTips: [],
  },
  {
    id: "13-size-spec",
    name: "Size Spec",
    nameZh: "规格表",
    triggers: ["size", "spec", "规格", "尺码"],
    description: "Spec sheet with measurements, weight, dimensions.",
    defaultRatio: "1:1",
    promptTemplate:
      "Product specification sheet for {{product}}. " +
      "Top: clean product silhouette (side view, 30% of frame). " +
      "Middle: dimension callouts with arrows and measurements in cm/mm. " +
      "Bottom: small spec table (weight, material, dimensions). " +
      "White background, black text, thin sans-serif font.",
    variants: {},
    negativeConstraints: ["no fake specs (use real measurements)"],
    antiAiTips: ["Provide exact dimensions in the prompt for accuracy."],
    categoryTips: [],
  },
  {
    id: "14-multi-product",
    name: "Multi-Product",
    nameZh: "组合套装",
    triggers: ["multi", "bundle", "set", "套装", "组合"],
    description: "Bundle of multiple products. Drives AOV.",
    defaultRatio: "1:1",
    promptTemplate:
      "Multi-product flat-lay or staggered stack of {{product_count}} products: {{product_names}}. " +
      "Centered composition, all products clearly visible and labeled with small numbers (1, 2, 3). " +
      "Consistent lighting across all items, single light source. " +
      "Background: {{bg}}. Soft shadow under each item.",
    variants: {},
    negativeConstraints: ["no overlap that hides products", "no scale inconsistency"],
    antiAiTips: ["Specify relative sizes to avoid scale confusion."],
    categoryTips: [],
  },
  {
    id: "15-livestream",
    name: "Livestream",
    nameZh: "直播",
    triggers: ["livestream", "直播"],
    description: "Live stream overlay-ready image. Subject prominent, space for UI elements.",
    defaultRatio: "9:16",
    promptTemplate:
      "Vertical livestream scene. {{product}} on a stand or held by a hand. " +
      "RGB ring light glow on the subject. " +
      "Top 15% of frame: clear space for streamer's face overlay. " +
      "Bottom 20%: clear space for product name + price + 'Buy' button overlay. " +
      "Background: cluttered home or studio, intentionally lively.",
    variants: {},
    negativeConstraints: ["no AI face (uncanny valley)", "no over-polished"],
    antiAiTips: ["Add 'mid-action, slight motion blur' for livestream authenticity."],
    categoryTips: [],
  },
  {
    id: "16-try-on-virtual",
    name: "Virtual Try-On",
    nameZh: "虚拟试穿",
    triggers: ["try on", "试穿", "换装"],
    description: "Apparel or accessories visualized on a model without a photoshoot.",
    defaultRatio: "3:4",
    promptTemplate:
      "Virtual try-on. {{model_description}} wearing {{product}}. " +
      "Studio backdrop, soft daylight. " +
      "Product should look naturally worn, with realistic fabric drape and creases. " +
      "Skin texture visible, no AI smoothing.",
    variants: {},
    negativeConstraints: ["no floating accessories", "no impossible proportions"],
    antiAiTips: ["Provide a real product reference image to anchor geometry."],
    categoryTips: [],
  },
  {
    id: "17-exploded-view",
    name: "Exploded View",
    nameZh: "爆炸图",
    triggers: ["exploded", "爆炸图"],
    description: "All parts separated in 3D space. For technical products.",
    defaultRatio: "4:3",
    promptTemplate:
      "Exploded technical view of {{product}}. All components floating in 3D space, separated along their assembly axis, with thin guide lines connecting them. " +
      "Each component labeled with a small number (1, 2, 3) and a callout. " +
      "Background: light blue or white. Engineering-drawing aesthetic.",
    variants: {},
    negativeConstraints: ["no fake components", "no illogical separation"],
    antiAiTips: ["Provide a real product reference for accurate component layout."],
    categoryTips: [],
  },
  {
    id: "18-ghost-mannequin",
    name: "Ghost Mannequin",
    nameZh: "人台 / 隐形模特",
    triggers: ["ghost", "mannequin", "3D", "人台"],
    description: "Apparel shown as if worn but the model is invisible. E-commerce standard.",
    defaultRatio: "3:4",
    promptTemplate:
      "Ghost mannequin photograph. {{product}} (apparel item) shown as if worn, but with no visible body. " +
      "Internal structure should hold the shape — collar upright, sleeves naturally draped. " +
      "White background #FFFFFF. Even soft lighting. " +
      "Photoreal fabric texture, no wrinkles that wouldn't occur on a real wearer.",
    variants: {},
    negativeConstraints: ["no visible body parts", "no mannequin head"],
    antiAiTips: ["Use a real product photo as the reference image to anchor the silhouette."],
    categoryTips: [],
  },
  {
    id: "19-multi-angle-grid",
    name: "Multi-Angle Grid",
    nameZh: "多角度",
    triggers: ["grid", "multi-angle", "多角度", "360"],
    description: "4-6 angles of the same product in a grid. E-commerce standard.",
    defaultRatio: "1:1",
    promptTemplate:
      "4-panel grid showing {{product}} from different angles: front 3/4, top-down overhead, side 90°, rear 45°. " +
      "Each panel has identical lighting and background. " +
      "Subtle thin grid lines between panels. " +
      "Background: #FFFFFF. Each panel labeled with the angle in small text.",
    variants: {},
    negativeConstraints: ["no scale inconsistency between panels"],
    antiAiTips: ["Reference a real product photo to keep scale consistent."],
    categoryTips: [],
  },
  {
    id: "20-magazine-editorial",
    name: "Magazine Editorial",
    nameZh: "杂志大片",
    triggers: ["magazine", "editorial", "杂志"],
    description: "High-fashion editorial. Aspirational, brand-forward.",
    defaultRatio: "3:4",
    promptTemplate:
      "Magazine editorial photograph. {{product}} styled with strong visual narrative. " +
      "Studio with single dramatic light. " +
      "Composition uses rule of thirds, negative space, leading lines. " +
      "Color palette: muted, sophisticated. Photoreal, looks like a Vogue spread.",
    variants: {},
    negativeConstraints: ["no watermarks", "no fake magazine covers"],
    antiAiTips: ["Specify a publication reference ('in the style of Wallpaper* magazine')."],
    categoryTips: [],
  },
  {
    id: "21-seasonal-campaign",
    name: "Seasonal Campaign",
    nameZh: "季节性营销",
    triggers: ["seasonal", "holiday", "季节", "节日"],
    description: "Holiday/seasonal themed campaign. Drives urgency.",
    defaultRatio: "16:9",
    promptTemplate:
      "Seasonal campaign image for {{product}}. {{season}} theme. " +
      "Color palette matches the season ({{palette}}). " +
      "Optional seasonal prop in the background (snow, leaves, fireworks — keep subtle). " +
      "Headline area: top center, max 8 words. " +
      "Urgency cue: small badge in corner 'Limited time'.",
    variants: {},
    negativeConstraints: ["no offensive holiday iconography", "no fake prices"],
    antiAiTips: ["Keep seasonal props subtle — too much kills the premium feel."],
    categoryTips: [],
  },
  {
    id: "22-luxury-atmospherics",
    name: "Luxury Atmosphere",
    nameZh: "轻奢高级感",
    triggers: ["luxury", "smoke", "轻奢", "高级"],
    description: "Premium feel with smoke, dark backdrop, controlled light.",
    defaultRatio: "3:4",
    promptTemplate:
      "Luxury product photography. {{product}} on a velvet plinth. " +
      "Charcoal #1A1A1A or deep emerald #1A3A2E backdrop. " +
      "Smoke or atmospheric haze drifting across. " +
      "Single hard rim light from the back, soft fill from the front. " +
      "Photoreal, premium feel, no text.",
    variants: {},
    negativeConstraints: ["no cheap-looking props", "no fake logos"],
    antiAiTips: ["Less is more — luxury = restraint."],
    categoryTips: [],
  },
  {
    id: "23-device-mockup",
    name: "Device Mockup",
    nameZh: "样机",
    triggers: ["mockup", "device", "app", "样机"],
    description: "App or website shown on a device. For SaaS or app products.",
    defaultRatio: "16:9",
    promptTemplate:
      "Device mockup. {{device}} (laptop/phone/tablet) at 30-degree angle, screen facing camera. " +
      "Screen shows {{app_or_site}}. " +
      "Background: minimal desk or studio. Soft daylight. " +
      "Subtle reflection on the screen surface. Photoreal.",
    variants: {},
    negativeConstraints: ["no fake UI elements that look broken"],
    antiAiTips: ["Provide a real app screenshot as the reference image for accurate UI rendering."],
    categoryTips: [],
  },
  {
    id: "24-storefront",
    name: "Storefront",
    nameZh: "店铺",
    triggers: ["storefront", "shop", "店铺", "陈列"],
    description: "Retail / e-commerce storefront display. For B2B or DTC brand presence.",
    defaultRatio: "16:9",
    promptTemplate:
      "Storefront / retail display. {{product}} placed in a boutique or shelf environment. " +
      "Soft warm lighting, 3200K. " +
      "Adjacent products visible (blurred, not in focus). " +
      "Architectural elements: wooden shelves, marble countertop, plants. " +
      "Photoreal, premium retail aesthetic.",
    variants: {},
    negativeConstraints: ["no fake brand signage"],
    antiAiTips: ["Use a real storefront photo as reference for layout."],
    categoryTips: [],
  },
  {
    id: "25-sports-campaign",
    name: "Sports Campaign",
    nameZh: "运动",
    triggers: ["sports", "fitness", "运动", "户外"],
    description: "Sports / fitness / outdoor context. Energy, motion, performance.",
    defaultRatio: "16:9",
    promptTemplate:
      "Sports campaign photograph. {{product}} in active use — running, climbing, swimming, lifting. " +
      "Dynamic 3/4 angle, frozen mid-action. " +
      "Dramatic rim light from behind, hard sun. " +
      "Motion blur on limbs/equipment but product sharp. " +
      "Color: high contrast, energetic. Photoreal.",
    variants: {},
    negativeConstraints: ["no fake athletic endorsements", "no AI-generated human faces"],
    antiAiTips: ["Capture moment, not stock — specify 'mid-stride, sweat droplets'."],
    categoryTips: [],
  },
];

/** Look up a template by id. */
export function getSceneTemplate(
  id: string,
): EcomSceneTemplate | undefined {
  return SCENE_TEMPLATES.find((t) => t.id === id);
}

/** Match a template by user-supplied keywords. Falls back to 01-hero-image. */
export function matchSceneTemplate(query: string): EcomSceneTemplate {
  const q = query.toLowerCase();
  for (const template of SCENE_TEMPLATES) {
    if (template.triggers.some((t) => q.includes(t.toLowerCase()))) {
      return template;
    }
  }
  return SCENE_TEMPLATES[0]!;
}
