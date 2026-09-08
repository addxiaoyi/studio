"use client";

/**
 * features-data.ts — single source of truth for the showcase section.
 * Each entry drives a left/right alternating row in FeatureShowcase.
 *
 * Extracted so a marketing team can edit copy without touching layout.
 */

import { Layout, MessageSquare, Palette, MousePointer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { slideInLeft, slideInRight } from "@/components/landing/motion";
import type { Variants } from "framer-motion";

import {
  CanvasVisual,
  ChatVisual,
  BrandVisual,
  EditVisual,
} from "./visual-images";

export interface FeatureEntry {
  id: "canvas" | "chat" | "brand" | "edit";
  icon: LucideIcon;
  title: string;
  description: string;
  visual: React.ReactNode;
  reversed: boolean;
  textVariants: Variants;
  visualVariants: Variants;
  metric?: { value: string; label: string };
}

export const FEATURE_ENTRIES: FeatureEntry[] = [
  {
    id: "canvas",
    icon: Layout,
    title: "画布级 AI 创作",
    description:
      "在无限画布上与 AI 协作。从一个简单想法开始，AI 自动构建完整设计系统——布局、配色、排版、文案，一处对话即可全画布联动。",
    visual: <CanvasVisual />,
    reversed: false,
    textVariants: slideInLeft,
    visualVariants: slideInRight,
    metric: { value: "8x", label: "创意产出速度" },
  },
  {
    id: "chat",
    icon: MessageSquare,
    title: "上下文感知的智能对话",
    description:
      "Helstera 理解画布全貌与品牌语境，主动建议而非机械执行。说“把左图换成暖色调”，AI 已经知道你说的是哪个元素。",
    visual: <ChatVisual />,
    reversed: true,
    textVariants: slideInRight,
    visualVariants: slideInLeft,
    metric: { value: "15+", label: "主流 AI 模型" },
  },
  {
    id: "brand",
    icon: Palette,
    title: "品牌一致性自动保障",
    description:
      "Brand Kit 集中管理色板、字体、Logo、语料。AI 每次生成都自动遵循，告别“五颜六色”的散乱设计。",
    visual: <BrandVisual />,
    reversed: false,
    textVariants: slideInLeft,
    visualVariants: slideInRight,
    metric: { value: "100%", label: "品牌规范遵循" },
  },
  {
    id: "edit",
    icon: MousePointer,
    title: "像素级精准编辑",
    description:
      "AI 生成只是起点。画布上每个元素都可直接调整——位置、尺寸、颜色、字体，让设计最终完美符合预期。",
    visual: <EditVisual />,
    reversed: true,
    textVariants: slideInRight,
    visualVariants: slideInLeft,
  },
];

