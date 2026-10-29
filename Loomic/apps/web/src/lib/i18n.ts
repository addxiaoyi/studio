// @i18n — Locale-aware message dictionary
// All user-facing strings live here for easy extraction. For full i18n, swap
// this with a proper library (next-intl, react-i18next) — the call sites
// already centralize through these dictionaries.
import { useEffect, useState } from "react";

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
    canvas: {
      tools: {
        hand: "拖拽画布 (H)",
        selection: "选择 (V)",
        rectangle: "矩形 (R)",
        ellipse: "椭圆 (O)",
        arrow: "箭头 (A)",
        line: "直线 (L)",
        freedraw: "画笔 (P)",
        text: "文字 (T)",
        image: "图片 (9)",
        imageAi: "AI 生成图片",
        videoAi: "AI 生成视频",
        decompose: "拆分为可编辑图层",
      },
      contextMenu: {
        copy: "复制",
        paste: "粘贴",
        delete: "删除",
        bringToFront: "置顶",
        sendToBack: "置底",
        lock: "锁定",
        unlock: "解锁",
        group: "分组",
        ungroup: "取消分组",
        copyStyles: "复制样式",
        export: "导出",
        addLink: "添加链接",
      },
      generating: "生成中…",
    },
    workspace: {
      home: "工作台",
      projects: "项目",
      brandKit: "品牌套件",
      team: "团队",
      skills: "技能",
      ecom: "电商图",
      settings: "设置",
      models: "模型配置",
      mainNav: "主导航",
    },
    agent: {
      title: "AI 模型",
      description: "为你的工作区选择默认 AI 模型。",
      defaultModel: "默认模型",
      loading: "加载模型中",
      loadFailed: "模型列表加载失败，请稍后刷新。",
      empty: "暂无可用的 Agent 对话模型。",
      mediaHint: "图片和视频模型请在工作台输入框的“生成模型”中选择。",
      configure: "配置模型服务",
      allSessions: "所有新会话将默认使用此模型。",
      updated: "已更新默认模型。",
      updateFailed: "更新失败，请稍后重试。",
      saving: "保存中...",
      save: "保存",
    },
    team: {
      invite: "邀请成员",
      email: "邮箱地址",
      role: "角色",
      selected: "已选择",
      or: "或",
      copyLink: "复制邀请链接",
      copied: "已复制",
      copy: "复制",
      cancel: "取消",
      sendInvite: "发送邀请",
      member: "成员",
      memberDesc: "可以创建和编辑项目",
      admin: "管理员",
      adminDesc: "管理团队成员和设置",
      billing: "额度管理员",
      billingDesc: "管理额度充值和账单",
    },
    billing: {
      title: "余额与充值",
      description:
        "一次性充值，余额永久有效。所有 AI 模型按需使用，按实际用量扣款。",
      custom: "自定义充值",
      customHint: "¥10–¥50,000，1 元 = 1 元余额",
      amount: "充值金额（元）",
      topup: "充值",
      balance: "当前余额",
      available: "可用余额（元）",
      toppedUp: "累计充值",
      spent: "已消耗",
      choose: "选择充值包",
      chinaHint: "中国大陆：易支付 (YeePay)，支持支付宝/微信扫码",
      internationalHint: "国际支付渠道正在接入中，当前仅开放 CNY 易支付充值",
      paid: "充值已到账。",
      incomplete: "充值订单未完成，请重新选择充值包。",
      unknown: "订单状态暂时无法确认，请稍后刷新页面。",
      international: "国际支付渠道正在接入中，请切换为 CNY 使用易支付充值。",
      createFailed: "创建订单失败，请重试。",
      invalidAmount: "自定义充值金额需为 ¥10 至 ¥50,000。",
      history: "余额流水",
      scanPay: "扫码支付",
      openPayment: "在新窗口打开支付页",
      closePayment: "关闭支付窗口",
      cashier: "易支付扫码收银台",
      bestValue: "最划算",
      credits: "积分",
      bonus: "加赠",
      total: "合计",
      permanent: "永久有效",
      processing: "处理中...",
      buy: "立即充值",
    },
    generation: {
      imageFailed: "图片生成失败，请重试或更换模型。",
      videoFailed: "视频生成失败，请重试或更换模型。",
      failed: "生成失败",
      prompt: "今天我们要创作什么",
      firstFrame: "首帧",
      lastFrame: "尾帧",
      download: "下载",
      generating: "生成中…",
      retry: "重试",
    },
    project: {
      deleteTitle: "删除项目",
      deleteConfirm: "项目会移入回收站，7 天后自动清理；在此之前可以从回收站恢复。",
      cancel: "取消",
      moveToRecovery: "移到回收站",
      deleted: "项目已删除",
      deleteFailed: "项目删除失败",
    },
    authForm: {
      welcome: "欢迎回来",
      signInWorkspace: "登录你的工作区",
      email: "邮箱",
      password: "密码",
      emailPlaceholder: "you@example.com",
      codeTitle: "输入邮箱验证码",
      codeSent: "验证码已发送至",
      codePlaceholder: "6 位验证码",
      verifying: "验证中...",
      verifyLogin: "验证并登录",
      resend: "重新发送验证码",
      sending: "正在发送验证码...",
      sendCode: "发送验证码",
      loggingIn: "正在登录...",
      login: "登录",
      useCode: "使用验证码登录",
      usePassword: "使用密码登录",
      needAccount: "还没有账户？",
      createOne: "创建账户",
      workspaceError: "无法加载工作区，请重试。",
      mailError: "登录邮件发送失败，请稍后重试",
      codeError: "验证码错误或已过期",
      passwordError: "邮箱或密码不正确",
    },
    registerForm: {
      checkEmail: "请查收邮件",
      sentTo: "确认链接已发送至",
      backToSignIn: "返回登录",
      create: "创建账户",
      description: "使用邮箱和密码开始",
      email: "邮箱",
      password: "密码",
      confirmPassword: "确认密码",
      placeholder: "you@example.com",
      creating: "正在创建账号...",
      consent: "我已阅读并同意",
      terms: "服务条款",
      privacy: "隐私政策",
      or: "或",
      existing: "已有账户？",
      signIn: "登录",
      consentError: "请先同意服务条款和隐私政策",
      mismatch: "两次输入的密码不一致",
      createError: "注册失败，请稍后重试",
      workspaceError: "无法完成工作区创建，请重试",
    },
    brandKit: {
      none: "无",
      label: "品牌套件",
      empty: "暂无品牌套件",
      emptyTitle: "还没有品牌套件",
      emptyDescription: "创建一个品牌套件，集中管理色板、字体和 Logo。",
      create: "创建品牌套件",
      applyToProject: "应用到新项目",
      copy: "复制",
      delete: "删除",
      cancel: "取消",
      add: "添加",
      save: "保存",
      addColor: "添加颜色",
      addFont: "添加字体",
      noFonts: "未找到匹配字体",
      loading: "加载中...",
      searchFonts: "搜索字体...",
      allFonts: "全部字体",
    },
    projects: { title: "项目", create: "新建项目", delete: "删除项目" },
    admin: {
      title: "模型供应商配置",
      description:
        "管理兼容网关、API Key 和模型分配策略。完整 Key 只在录入时可见。",
      area: "管理员区域",
      denied: "没有管理员权限",
      deniedDescription: "只有工作区所有者或管理员可以管理模型供应商。",
      gateway: "网关连接",
      addKey: "添加 Key",
      enabled: "启用",
      disabled: "停用",
      save: "保存供应商配置",
      saving: "保存中...",
      loading: "正在加载配置...",
      probe: "探测",
      delete: "删除",
      capabilities: "模型能力",
      probeAll: "全部探测",
      probing: "探测中...",
    },
    authShell: {
      brand: "品牌介绍",
      signInTitle: "欢迎回来",
      signInDescription: "登录后继续使用你的工作区。",
      signInFeatures: [
        "支持密码或邮箱验证码登录",
        "画布与工作区状态统一保存",
        "从灵感到交付无需切换工具",
      ],
      registerTitle: "创建工作区账户",
      registerDescription:
        "使用邮箱和密码注册，确认邮箱后即可在任意设备继续使用同一画布。",
      registerFeatures: [
        "创建专属邮箱密码账户",
        "确认邮箱后返回工作区",
        "使用与登录用户一致的工作区布局",
      ],
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
    canvas: {
      tools: {
        hand: "Pan (H)",
        selection: "Select (V)",
        rectangle: "Rectangle (R)",
        ellipse: "Ellipse (O)",
        arrow: "Arrow (A)",
        line: "Line (L)",
        freedraw: "Draw (P)",
        text: "Text (T)",
        image: "Image (9)",
        imageAi: "Generate image",
        videoAi: "Generate video",
        decompose: "Split into editable layers",
      },
      contextMenu: {
        copy: "Copy",
        paste: "Paste",
        delete: "Delete",
        bringToFront: "Bring to front",
        sendToBack: "Send to back",
        lock: "Lock",
        unlock: "Unlock",
        group: "Group",
        ungroup: "Ungroup",
        copyStyles: "Copy styles",
        export: "Export",
        addLink: "Add link",
      },
      generating: "Generating…",
    },
    workspace: {
      home: "Workspace",
      projects: "Projects",
      brandKit: "Brand kit",
      team: "Team",
      skills: "Skills",
      ecom: "E-commerce",
      settings: "Settings",
      models: "Model settings",
      mainNav: "Main navigation",
    },
    agent: {
      title: "AI models",
      description: "Choose the default AI model for your workspace.",
      defaultModel: "Default model",
      loading: "Loading models",
      loadFailed: "Unable to load models. Please refresh and try again.",
      empty: "No Agent conversation models are available.",
      mediaHint:
        "Choose image and video models from the “Generation model” picker in the workspace.",
      configure: "Configure model providers",
      allSessions: "All new sessions will use this model by default.",
      updated: "Default model updated.",
      updateFailed: "Update failed. Please try again.",
      saving: "Saving...",
      save: "Save",
    },
    team: {
      invite: "Invite member",
      email: "Email address",
      role: "Role",
      selected: "Selected",
      or: "or",
      copyLink: "Copy invite link",
      copied: "Copied",
      copy: "Copy",
      cancel: "Cancel",
      sendInvite: "Send invite",
      member: "Member",
      memberDesc: "Create and edit projects",
      admin: "Admin",
      adminDesc: "Manage team members and settings",
      billing: "Billing admin",
      billingDesc: "Manage top-ups and billing",
    },
    billing: {
      title: "Credits and top-ups",
      description:
        "Buy credits once. They never expire. AI models consume credits based on usage.",
      custom: "Custom top-up",
      customHint: "¥10–¥50,000, ¥1 = ¥1 balance",
      amount: "Top-up amount (CNY)",
      topup: "Top up",
      balance: "Current balance",
      available: "Available balance (CNY)",
      toppedUp: "Total topped up",
      spent: "Spent",
      choose: "Choose a top-up package",
      chinaHint: "Mainland China: YeePay, Alipay and WeChat Pay QR codes",
      internationalHint:
        "International payments are coming soon. Use CNY YeePay for now.",
      paid: "Top-up credited.",
      incomplete: "Top-up was not completed. Please choose a package again.",
      unknown:
        "The order status could not be confirmed. Refresh and try again.",
      international:
        "International payments are coming soon. Switch to CNY to use YeePay.",
      createFailed: "Could not create the order. Please try again.",
      invalidAmount: "Custom top-ups must be between ¥10 and ¥50,000.",
      history: "Credit history",
      scanPay: "Scan to pay",
      openPayment: "Open payment page in a new window",
      closePayment: "Close payment window",
      cashier: "YeePay QR checkout",
      bestValue: "Best value",
      credits: "credits",
      bonus: "bonus",
      total: "Total",
      permanent: "Never expires",
      processing: "Processing...",
      buy: "Top up now",
    },
    generation: {
      imageFailed:
        "Image generation failed. Try again or choose another model.",
      videoFailed:
        "Video generation failed. Try again or choose another model.",
      failed: "Generation failed",
      prompt: "What shall we create today?",
      firstFrame: "First frame",
      lastFrame: "Last frame",
      download: "Download",
      generating: "Generating…",
      retry: "Retry",
    },
    project: {
      deleteTitle: "Delete project",
      deleteConfirm: "The project will move to the recovery area and be cleaned up after 7 days. You can restore it before then.",
      cancel: "Cancel",
      moveToRecovery: "Move to recovery",
      deleted: "Project deleted",
      deleteFailed: "Could not delete the project",
    },
    authForm: {
      welcome: "Welcome back",
      signInWorkspace: "Sign in to your workspace",
      email: "Email",
      password: "Password",
      emailPlaceholder: "you@example.com",
      codeTitle: "Enter your email code",
      codeSent: "Code sent to",
      codePlaceholder: "6-digit code",
      verifying: "Verifying...",
      verifyLogin: "Verify and sign in",
      resend: "Send another code",
      sending: "Sending code...",
      sendCode: "Send code",
      loggingIn: "Signing in...",
      login: "Sign in",
      useCode: "Use code sign-in",
      usePassword: "Use password instead",
      needAccount: "Need an account?",
      createOne: "Create one",
      workspaceError: "Could not load your workspace. Please try again.",
      mailError: "Could not send the sign-in email. Please try again.",
      codeError: "The code is invalid or expired.",
      passwordError: "The email or password is incorrect.",
    },
    registerForm: {
      checkEmail: "Check your email",
      sentTo: "We sent a confirmation link to",
      backToSignIn: "Back to sign in",
      create: "Create your account",
      description: "Start with email and password",
      email: "Email",
      password: "Password",
      confirmPassword: "Confirm password",
      placeholder: "you@example.com",
      creating: "Creating account...",
      consent: "I have read and agree to the",
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      or: "or",
      existing: "Already have an account?",
      signIn: "Sign in",
      consentError: "Please agree to the terms and privacy policy first",
      mismatch: "Passwords do not match",
      createError: "Could not create your account. Please try again.",
      workspaceError:
        "Could not finish creating your workspace. Please try again.",
    },
    brandKit: {
      none: "None",
      label: "Brand kit",
      empty: "No brand kits yet",
      emptyTitle: "No brand kit yet",
      emptyDescription:
        "Create a brand kit to manage colors, fonts, and logos in one place.",
      create: "Create brand kit",
      applyToProject: "Apply to new project",
      copy: "Copy",
      delete: "Delete",
      cancel: "Cancel",
      add: "Add",
      save: "Save",
      addColor: "Add color",
      addFont: "Add font",
      noFonts: "No matching fonts",
      loading: "Loading...",
      searchFonts: "Search fonts...",
      allFonts: "All fonts",
    },
    projects: {
      title: "Projects",
      create: "New project",
      delete: "Delete project",
    },
    admin: {
      title: "Model provider settings",
      description:
        "Manage compatible gateways, API keys, and model routing. Full keys are visible only when entered.",
      area: "Admin area",
      denied: "Admin access required",
      deniedDescription:
        "Only workspace owners and admins can manage model providers.",
      gateway: "Gateway connection",
      addKey: "Add key",
      enabled: "Enabled",
      disabled: "Disabled",
      save: "Save provider settings",
      saving: "Saving...",
      loading: "Loading settings...",
      probe: "Probe",
      delete: "Delete",
      capabilities: "Model capabilities",
      probeAll: "Probe all",
      probing: "Probing...",
    },
    authShell: {
      brand: "Brand introduction",
      signInTitle: "Welcome back",
      signInDescription: "Sign in to continue using your workspace.",
      signInFeatures: [
        "Use password or email code sign-in",
        "Keep canvas and workspace state together",
        "Move from idea to delivery without switching tools",
      ],
      registerTitle: "Create a workspace account",
      registerDescription:
        "Register with email and password, then continue using the same canvas from any device.",
      registerFeatures: [
        "Create a dedicated email and password account",
        "Return to your workspace after confirming email",
        "Use the same workspace layout as signed-in users",
      ],
    },
  },
} as const;

/** Explicit locale chosen by the user. Written only when a switch is provided. */
export const LOCALE_STORAGE_KEY = "helstera.locale";
export const LOCALE_CHANGED_EVENT = "helstera:locale-changed";

export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return stored === "zh-CN" || stored === "en-US" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Persist an explicit choice and notify every mounted `useLocale` consumer.
 * Without the event the switch would only affect components mounted afterwards.
 */
export function setStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private mode or a full quota: the choice stays in-memory for this session.
  }
  window.dispatchEvent(new CustomEvent(LOCALE_CHANGED_EVENT, { detail: locale }));
}

export function detectLocale(): Locale {
  // An explicit choice always wins over the document language, which is hardcoded
  // to zh-CN for the Chinese-first web product.
  const stored = readStoredLocale();
  if (stored) return stored;
  if (typeof window === "undefined") return "zh-CN";
  const lang = document.documentElement.lang || window.navigator?.language || "";
  if (lang.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function t(locale: Locale | null | undefined): (typeof messages)[Locale] {
  return messages[locale as Locale] ?? messages["zh-CN"];
}

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>("zh-CN");
  useEffect(() => {
    setLocale(detectLocale());
    const onLocaleChanged = () => setLocale(detectLocale());
    window.addEventListener(LOCALE_CHANGED_EVENT, onLocaleChanged);
    return () => window.removeEventListener(LOCALE_CHANGED_EVENT, onLocaleChanged);
  }, []);
  return locale;
}
