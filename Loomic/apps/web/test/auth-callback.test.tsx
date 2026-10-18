// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockReplace, mockExchangeLocalToken } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockExchangeLocalToken: vi.fn(),
}));
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => ({ get: (key: string) => currentSearchParams.get(key) })),
}));

vi.mock("../src/lib/local-auth", () => ({
  exchangeLocalToken: mockExchangeLocalToken,
}));

import CallbackPage from "../src/app/auth/callback/page";

describe("Auth callback page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
  });
  afterEach(() => cleanup());

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
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login?error=local_auth_callback_required"));
  });
});
