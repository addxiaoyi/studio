import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  detectLocale,
  readStoredLocale,
  setStoredLocale,
  useLocale,
} from "../src/lib/i18n";

// jsdom does not provide localStorage without an origin; the desktop tests stub it the
// same way so the chosen locale is observable instead of silently dropped.
const storageValues = new Map<string, string>();
const storage = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageValues.set(key, value);
  },
  removeItem: (key: string) => {
    storageValues.delete(key);
  },
  clear: () => storageValues.clear(),
};

function LocaleProbe() {
  const locale = useLocale();
  return <span data-testid="locale">{locale}</span>;
}

describe("desktop locale selection", () => {
  beforeEach(() => {
    document.documentElement.lang = "zh-CN";
    storageValues.clear();
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  });

  afterEach(() => {
    storageValues.clear();
  });

  it("defaults to Chinese so the desktop shell keeps its current contract", () => {
    expect(readStoredLocale()).toBeNull();
    expect(detectLocale()).toBe("zh-CN");
  });

  it("honours an explicit choice even though the document language stays zh-CN", () => {
    storage.setItem(LOCALE_STORAGE_KEY, "en-US");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(detectLocale()).toBe("en-US");
  });

  it("ignores an unknown stored value instead of trusting it", () => {
    storage.setItem(LOCALE_STORAGE_KEY, "fr-FR");
    expect(readStoredLocale()).toBeNull();
    expect(detectLocale()).toBe("zh-CN");
  });

  it("re-renders mounted consumers when the choice changes, without a reload", () => {
    render(<LocaleProbe />);
    expect(screen.getByTestId("locale").textContent).toBe("zh-CN");

    act(() => setStoredLocale("en-US"));
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");

    act(() => setStoredLocale("zh-CN"));
    expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
  });
});
