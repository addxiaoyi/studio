"use client";

/**
 * steps-data.ts — the 4-step onboarding flow.
 * Order: setup → collaborate → apply → publish.
 */

import {
  Building2,
  MessageSquare,
  Sparkles,
  Paintbrush,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface Step {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export const STEPS: Step[] = [
  {
    number: "01",
    icon: Building2,
    title: "建立品牌工作区",
    description:
      "上传 Logo、色板、字体、语料，Helstera 几分钟内自动整理为可用的 Brand Kit，全团队共享。",
  },
  {
    number: "02",
    icon: MessageSquare,
    title: "团队对话协作",
    description:
      "邀请设计师、文案、运营加入同一个画布，在对话中描述需求，AI 实时生成多种方案。",
  },
  {
    number: "03",
    icon: Sparkles,
    title: "AI 自动遵循品牌",
    description:
      "所有生成内容自动匹配品牌规范，色彩、字体、Logo 使用全自动，无需人工校对。",
  },
  {
    number: "04",
    icon: Paintbrush,
    title: "精修与一键发布",
    description:
      "画布上精细调整每个元素，满意后一键导出或发布到 Figma、Slack、Notion 等工作流。",
  },
];
