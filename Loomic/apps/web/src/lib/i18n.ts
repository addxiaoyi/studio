// @i18n — Locale-aware message dictionary
// All user-facing strings live here for easy extraction. For full i18n, swap
// this with a proper library (next-intl, react-i18next) — the call sites
// already centralize through these dictionaries.

export type Locale = "zh-CN" | "en-US";

export const messages = {
  "zh-CN": {
    nav: {
      features: "功能",
      solutions: "解决方案",
      customers: "客户案例",
      pricing: "定价",
      signIn: "登录",
      signUp: "免费试用",
    },
    hero: {
      badge: "企业级 AI 画布 · 品牌一致性保障",
      cta: "免费开始试用",
      ctaSecondary: "查看企业方案",
    },
    pricing: {
      title: "选择你的计划",
      subtitle: "灵活定价，按需选择",
    },
    topup: {
      experience: "体验包",
      standard: "标准包",
      pro: "专业包",
      business: "商务包",
      buyNow: "立即购买",
      regionCN: "中国大陆 (CNY)",
      regionIntl: "International (USD)",
    },
    auth: {
      signInTitle: "欢迎回来",
      signInDescription: "登录后继续你的工作",
      signUpTitle: "创建账户",
      signUpDescription: "开始使用 Helstera",
    },
    common: {
      loading: "加载中…",
      retry: "重试",
      cancel: "取消",
      confirm: "确认",
      back: "返回",
      next: "下一步",
      save: "保存",
    },
    error: {
      generic: "出了点问题，请稍后重试",
      network: "网络连接失败",
      notFound: "页面不存在",
    },
  },
  "en-US": {
    nav: {
      features: "Features",
      solutions: "Solutions",
      customers: "Customers",
      pricing: "Pricing",
      signIn: "Sign in",
      signUp: "Try free",
    },
    hero: {
      badge: "Enterprise AI canvas · Brand consistency built-in",
      cta: "Start free trial",
      ctaSecondary: "Enterprise plans",
    },
    pricing: {
      title: "Choose your plan",
      subtitle: "Flexible pricing, pay as you go",
    },
    topup: {
      experience: "Starter",
      standard: "Standard",
      pro: "Pro",
      business: "Business",
      buyNow: "Buy now",
      regionCN: "China (CNY)",
      regionIntl: "International (USD)",
    },
    auth: {
      signInTitle: "Welcome back",
      signInDescription: "Sign in to continue your work",
      signUpTitle: "Create account",
      signUpDescription: "Get started with Helstera",
    },
    common: {
      loading: "Loading…",
      retry: "Retry",
      cancel: "Cancel",
      confirm: "Confirm",
      back: "Back",
      next: "Next",
      save: "Save",
    },
    error: {
      generic: "Something went wrong. Please try again.",
      network: "Network connection failed",
      notFound: "Page not found",
    },
  },
} as const;

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  const lang = window.navigator?.language ?? "";
  if (lang.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function t(locale: Locale): (typeof messages)[Locale] {
  return messages[locale];
}
