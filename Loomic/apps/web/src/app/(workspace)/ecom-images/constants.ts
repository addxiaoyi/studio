import type { SceneId } from "@helstera/shared";

export type SceneCategory = "产品" | "营销" | "信息";

export interface SceneDefinition {
  id: SceneId;
  name: string;
  nameZh: string;
  category: SceneCategory;
}

// Scene definitions (kept inline to avoid heavy import; mirrored from shared)
export const SCENES: SceneDefinition[] = [
  { id: "01-hero-image", name: "Hero Image", nameZh: "白底主图", category: "产品" },
  { id: "02-lifestyle-scene", name: "Lifestyle", nameZh: "场景图", category: "产品" },
  { id: "03-flat-lay", name: "Flat Lay", nameZh: "平铺", category: "产品" },
  { id: "04-detail-macro", name: "Detail Macro", nameZh: "特写", category: "产品" },
  { id: "05-poster-banner", name: "Poster", nameZh: "海报", category: "营销" },
  { id: "06-social-media", name: "Social", nameZh: "社媒", category: "营销" },
  { id: "07-ugc-style", name: "UGC", nameZh: "晒单", category: "营销" },
  { id: "08-model-showcase", name: "Model", nameZh: "模特", category: "产品" },
  { id: "09-before-after", name: "Before/After", nameZh: "对比", category: "信息" },
  { id: "10-packaging", name: "Packaging", nameZh: "包装", category: "产品" },
  { id: "11-infographic", name: "Infographic", nameZh: "信息图", category: "信息" },
  { id: "12-creative-concept", name: "Creative", nameZh: "创意", category: "营销" },
  { id: "13-size-spec", name: "Size Spec", nameZh: "规格", category: "信息" },
  { id: "14-multi-product", name: "Bundle", nameZh: "套装", category: "产品" },
  { id: "15-livestream", name: "Livestream", nameZh: "直播", category: "营销" },
  { id: "16-try-on-virtual", name: "Try-On", nameZh: "试穿", category: "产品" },
  { id: "17-exploded-view", name: "Exploded", nameZh: "爆炸图", category: "信息" },
  { id: "18-ghost-mannequin", name: "Ghost", nameZh: "人台", category: "产品" },
  { id: "19-multi-angle-grid", name: "Multi-Angle", nameZh: "多角度", category: "产品" },
  { id: "20-magazine-editorial", name: "Editorial", nameZh: "杂志", category: "营销" },
  { id: "21-seasonal-campaign", name: "Seasonal", nameZh: "季节", category: "营销" },
  { id: "22-luxury-atmospherics", name: "Luxury", nameZh: "高级感", category: "营销" },
  { id: "23-device-mockup", name: "Device", nameZh: "样机", category: "信息" },
  { id: "24-storefront", name: "Storefront", nameZh: "店铺", category: "营销" },
  { id: "25-sports-campaign", name: "Sports", nameZh: "运动", category: "营销" },
];

export const RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "16:9", "9:16"] as const;

export const CATEGORIES: readonly SceneCategory[] = ["产品", "营销", "信息"] as const;
