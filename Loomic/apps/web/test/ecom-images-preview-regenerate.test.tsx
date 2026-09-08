// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;
const mockToken = "session-token";

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    session: {
      access_token: mockToken,
      user: { id: "user-1", email: "test@helstera.com" },
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("../src/hooks/use-credits", () => ({
  useCredits: () => ({
    balance: 10_000,
    totalToppedUp: 0,
    totalSpent: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import EcomImagesPage, { SCENES } from "../src/app/(workspace)/ecom-images/page";

beforeEach(() => {
  mockFetch.mockReset();
  sessionStorage.clear();
});

afterEach(cleanup);

describe("Prompt preview & regenerate", () => {
  it("does not show prompt preview button until scenes and product are set", async () => {
    render(<EcomImagesPage />);
    expect(
      screen.queryByRole("button", { name: /预览提示词/ }),
    ).not.toBeInTheDocument();
  });

  it("shows prompt preview button after typing product and selecting scene", async () => {
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    // Type a product name
    const nameInput = screen.getByPlaceholderText(/美的空气净化器/);
    await user.type(nameInput, "测试产品");

    // Select the first scene
    const firstSceneButton = screen
      .getAllByRole("button")
      .filter((btn) => btn.className.includes("rounded-xl"))[0];
    expect(firstSceneButton).toBeDefined();
    await user.click(firstSceneButton!);

    // Now preview button should appear
    expect(
      screen.getByRole("button", { name: /预览提示词/ }),
    ).toBeInTheDocument();
  });

  it("toggles prompt preview content when clicking the toggle", async () => {
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    // Set up product + scene
    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "智能音箱");
    const sceneBtn = screen
      .getAllByRole("button")
      .filter((btn) => btn.className.includes("rounded-xl"))[0]!;
    await user.click(sceneBtn);

    // Click preview toggle
    const toggle = screen.getByRole("button", { name: /预览提示词/ });
    await user.click(toggle);

    // Prompt preview content should now be visible
    await waitFor(() => {
      expect(screen.getByText(/智能音箱/)).toBeInTheDocument();
    });
  });

  it("auto-fills from sessionStorage on mount (regenerate flow)", async () => {
    sessionStorage.setItem(
      "ecom-regenerate-prefill",
      JSON.stringify({
        productName: "之前的商品",
        productDescription: "之前的描述",
        sceneIds: ["01-hero-image", "02-lifestyle-scene"],
        ratio: "1:1",
      }),
    );
    render(<EcomImagesPage />);

    // Product name pre-filled
    expect(
      (screen.getByPlaceholderText(/美的空气净化器/) as HTMLInputElement)
        .value,
    ).toBe("之前的商品");

    // Selected count shows 2 scenes
    await waitFor(() => {
      expect(screen.getByText(/已选 2/)).toBeInTheDocument();
    });

    // Prefill key should be consumed
    expect(sessionStorage.getItem("ecom-regenerate-prefill")).toBeNull();
  });

  it("ignores invalid prefill gracefully", () => {
    sessionStorage.setItem("ecom-regenerate-prefill", "{not json");
    expect(() => render(<EcomImagesPage />)).not.toThrow();
  });

  it("uses the matching SCENES registry (smoke check)", () => {
    // Sanity: SCENES exported from page module must be the shared registry
    expect(SCENES.length).toBe(25);
    expect(SCENES[0]?.id).toBe("01-hero-image");
  });
});
