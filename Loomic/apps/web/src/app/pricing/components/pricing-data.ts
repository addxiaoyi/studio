// Helstera Pricing Data — Top-up FAQ
// (Subscription tiers were removed; we now use credit top-ups.)

import type { Variants } from "framer-motion";

export type BillingPeriod = "monthly" | "yearly";

export interface FAQItem {
  question: string;
  answer: string;
}

export const faqItems: FAQItem[] = [
  {
    question: "积分是如何计算的？",
    answer:
      "不同模型、不同分辨率消耗不同积分。图片约 5-12 积分/张（HD/4K 加成），视频约 40-60 积分/5s 基础（按分辨率和时长累加）。",
  },
  {
    question: "未使用的积分会过期吗？",
    answer:
      "不会。积分永久有效，直到你使用完为止。我们也不会自动续费。",
  },
  {
    question: "30 天内未使用可以退款吗？",
    answer:
      "可以。购买后 30 天内未使用过的积分支持全额退款，已使用部分按比例扣除。",
  },
  {
    question: "支持哪些支付方式？",
    answer:
      "中国大陆：易支付 (YeePay)，支持支付宝、微信扫码。海外：Stripe 信用卡（即将上线）。",
  },
  {
    question: "积分可以转让给其他工作区吗？",
    answer:
      "目前不支持。积分按工作区 (workspace) 独立计数，每个工作区需要单独购买。",
  },
  {
    question: "不同模型消耗积分差异大吗？",
    answer:
      "是的。Gemini Nano Banana / DALL·E 3 / Seedream 等基础模型约 5 积分/张；GPT Image 1.5 / Imagen 4 约 8-12 积分/张。视频模型 Veo 3.1 / Kling 2.6 约 40-50 积分/5s。",
  },
  {
    question: "购买后多久到账？",
    answer:
      "支付成功后 1-2 秒自动到账。如果超过 30 秒未到账，请刷新页面或联系客服。",
  },
  {
    question: "可以开具发票吗？",
    answer:
      "目前为标准电子收据。企业发票（增值税专票/普票）需要联系销售申请，我们将在 5 个工作日内寄送。",
  },
];

// ── Animation variants (shared across pricing components) ──

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.08,
      duration: 0.6,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  }),
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.07, delayChildren: 0.15 },
  },
};
