const messages: Record<string, { zh: string; en: string }> = {
  google_unavailable: {
    zh: "Google 登录暂不可用，请使用邮箱登录或稍后重试。",
    en: "Google sign-in is unavailable. Use email or try again later.",
  },
  google_state_invalid: {
    zh: "Google 授权已过期或来源不匹配，请重新点击 Google 登录。",
    en: "Google authorization expired or does not match this browser. Start sign-in again.",
  },
  google_canceled: {
    zh: "你已取消 Google 授权，可以重新登录或使用邮箱。",
    en: "Google authorization was canceled. Try again or use email.",
  },
  google_failed: {
    zh: "Google 登录未完成，请重新尝试。",
    en: "Google sign-in did not finish. Please try again.",
  },
  google_link_required: {
    zh: "此 Google 账号使用非 Google 托管邮箱。请先通过邮箱登录或注册，再在个人设置中绑定 Google。",
    en: "First sign in or register with your email, then connect Google in your profile settings. Google does not manage this mailbox.",
  },
  google_link_signin_required: {
    zh: "请先使用邮箱登录，再在个人设置中绑定 Google。",
    en: "Sign in with email first, then connect Google in your profile settings.",
  },
  google_account_conflict: {
    zh: "该 Google 账号已绑定其他账号，或当前账号已绑定另一个 Google 账号。",
    en: "This Google account is already connected elsewhere, or your account already has another Google connection.",
  },
};

export function googleAuthMessage(
  code: string | null | undefined,
  english: boolean,
): string | undefined {
  return code ? messages[code]?.[english ? "en" : "zh"] : undefined;
}
