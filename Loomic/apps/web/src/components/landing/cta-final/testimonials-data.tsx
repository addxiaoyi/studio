"use client";

/**
 * testimonials-data.ts — quotes shown above the final CTA.
 * Extracted so marketing can edit content without touching layout.
 */

export interface Testimonial {
  quote: string;
  author: string;
  role: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "以前设计师和文案之间的来回修改至少要 3 天，现在 2 小时搞定。Brand Kit 确保所有素材风格统一。",
    author: "李总监",
    role: "品牌总监 · 快消行业",
  },
  {
    quote:
      "我们的内容团队从 3 人扩展到 15 人，Helstera 让我们保持一致的品牌调性，没有任何培训成本。",
    author: "张 VP",
    role: "市场 VP · 科技公司",
  },
  {
    quote:
      "私有化部署完全满足我们的合规要求。SSO 集成 2 天就上线了，API 也很稳定。",
    author: "王 IT",
    role: "IT 总监 · 金融行业",
  },
];
