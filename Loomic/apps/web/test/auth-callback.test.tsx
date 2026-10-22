// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockExchangeLocalToken,
  mockExchangeDesktopLoginToken,
  mockFinishBrowserLogin,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockExchangeLocalToken: vi.fn(),
  mockExchangeDesktopLoginToken: vi.fn(),
  mockFinishBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
}));
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => ({
    get: (key: string) => currentSearchParams.get(key),
  })),
}));

vi.mock("../src/lib/local-auth", () => ({
  exchangeLocalToken: mockExchangeLocalToken,
  exchangeDesktopLoginToken: mockExchangeDesktopLoginToken,
}));

import CallbackPage from "../src/app/auth/callback/page";

describe("Auth callback page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "electronAPI");
  });

  it("exchanges a local token and redirects to home", async () => {
    currentSearchParams = new URLSearchParams("local_token=magic-token");
    mockExchangeLocalToken.mockResolvedValue({ access_token: "session-token" });
    render(<CallbackPage />);
    await waitFor(() => {
      expect(mockExchangeLocalToken).toHaveBeenCalledWith("magic-token");
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });

  it("rejects remote-provider callback parameters in local-only mode", async () => {
    currentSearchParams = new URLSearchParams("code=remote-code");
    render(<CallbackPage />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "/login?error=local_auth_callback_required",
      ),
    );
  });

  it("reports a successful desktop token exchange to Electron", async () => {
    currentSearchParams = new URLSearchParams(
      `desktop_token=one-time&state=${"s".repeat(43)}`,
    );
    mockExchangeDesktopLoginToken.mockResolvedValue({
      access_token: "session-token",
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { finishBrowserLogin: mockFinishBrowserLogin },
    });

    render(<CallbackPage />);

    await waitFor(() => {
      expect(mockExchangeDesktopLoginToken).toHaveBeenCalledWith("one-time");
      expect(mockFinishBrowserLogin).toHaveBeenCalledWith(true);
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });

  it("reports a failed desktop token exchange to Electron", async () => {
    currentSearchParams = new URLSearchParams(
      `desktop_token=expired&state=${"s".repeat(43)}`,
    );
    mockExchangeDesktopLoginToken.mockRejectedValue(new Error("expired"));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { finishBrowserLogin: mockFinishBrowserLogin },
    });

    render(<CallbackPage />);

    await waitFor(() => {
      expect(mockFinishBrowserLogin).toHaveBeenCalledWith(false);
      expect(mockReplace).toHaveBeenCalledWith(
        "/login?error=desktop_auth_exchange_failed",
      );
    });
  });
});
