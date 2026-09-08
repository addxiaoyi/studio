// @i18n — Locale detection and message dictionary tests
import { describe, expect, it, vi } from "vitest";

import { detectLocale, messages, t } from "../src/lib/i18n.js";

describe("detectLocale", () => {
  it("returns zh-CN for Chinese browser", () => {
    vi.stubGlobal("navigator", { language: "zh-CN" });
    vi.stubGlobal("window", { navigator: { language: "zh-CN" } });
    expect(detectLocale()).toBe("zh-CN");
    vi.unstubAllGlobals();
  });

  it("returns en-US for English browser", () => {
    vi.stubGlobal("window", { navigator: { language: "en-US" } });
    expect(detectLocale()).toBe("en-US");
    vi.unstubAllGlobals();
  });

  it("returns zh-CN for zh-TW (Chinese variant)", () => {
    vi.stubGlobal("window", { navigator: { language: "zh-TW" } });
    expect(detectLocale()).toBe("zh-CN");
    vi.unstubAllGlobals();
  });
});

describe("t()", () => {
  it("returns the correct dictionary for a given locale", () => {
    const zh = t("zh-CN");
    expect(zh.nav.features).toBe("功能");
    const en = t("en-US");
    expect(en.nav.features).toBe("Features");
  });

  it("Chinese and English dictionaries have the same shape", () => {
    expect(Object.keys(messages["zh-CN"])).toEqual(
      Object.keys(messages["en-US"]),
    );
  });

  it("all required keys are present in both locales", () => {
    const zh = t("zh-CN");
    const en = t("en-US");
    expect(zh.nav).toBeDefined();
    expect(zh.hero).toBeDefined();
    expect(zh.pricing).toBeDefined();
    expect(zh.auth).toBeDefined();
    expect(zh.common).toBeDefined();
    expect(zh.error).toBeDefined();
    expect(en.nav).toBeDefined();
    expect(en.hero).toBeDefined();
    expect(en.pricing).toBeDefined();
    expect(en.auth).toBeDefined();
    expect(en.common).toBeDefined();
    expect(en.error).toBeDefined();
  });
});
