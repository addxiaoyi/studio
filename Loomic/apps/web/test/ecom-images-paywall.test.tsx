// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
const mockToken = "test-token";
globalThis.fetch = mockFetch;

let mockBalance = 0;

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
    balance: mockBalance,
    totalToppedUp: 0,
    totalSpent: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import EcomImagesPage from "../src/app/(workspace)/ecom-images/page";

beforeEach(() => {
  mockFetch.mockReset();
  sessionStorage.clear();
  mockBalance = 0;
});

afterEach(cleanup);

describe("Paywall (insufficient credits)", () => {
  it("disables generate button when user has 0 credits", async () => {
    mockBalance = 0;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    // Fill in product + scene
    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    const sceneBtn = screen
      .getAllByRole("button")
      .find((b) => b.dataset.testid === "scene-card")!;
    await user.click(sceneBtn);

    const genBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(genBtn).toBeDisabled();
  }, 20_000);

  it("shows '充值积分' link to settings when insufficient", async () => {
    mockBalance = 5;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    const sceneBtn = screen
      .getAllByRole("button")
      .find((b) => b.dataset.testid === "scene-card")!;
    await user.click(sceneBtn);

    const topUpLink = screen.getByRole("link", { name: /前往充值/ });
    expect(topUpLink).toBeInTheDocument();
    expect(topUpLink.getAttribute("href")).toContain("/settings");
  });

  it("displays credit balance and cost in glass card", async () => {
    mockBalance = 500;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    const sceneBtn = screen
      .getAllByRole("button")
      .find((b) => b.dataset.testid === "scene-card")!;
    await user.click(sceneBtn);

    expect(screen.getByText(/可用 \d+ 积分/)).toBeInTheDocument();
    expect(screen.getByText(/本次预计消耗/)).toBeInTheDocument();
    expect(screen.getByText(/可用 500 积分/)).toBeInTheDocument();
    expect(screen.getAllByText(/10/).length).toBeGreaterThan(0);
  });

  it("enables generate button when user has enough credits", async () => {
    mockBalance = 1000;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    const sceneBtn = screen
      .getAllByRole("button")
      .find((b) => b.dataset.testid === "scene-card")!;
    await user.click(sceneBtn);

    const genBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(genBtn).toBeEnabled();
    // No top-up link shown when affordable
    expect(
      screen.queryByRole("link", { name: /前往充值/ }),
    ).not.toBeInTheDocument();
  });

  it("scales credit cost with scene count", async () => {
    mockBalance = 1000;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    // Select three additional unselected scenes so the total is deterministic.
    const sceneButtons = screen.getAllByTestId("scene-card");
    const unselected = sceneButtons.filter((button) => button.getAttribute("aria-pressed") !== "true").slice(0, 2);
    for (const button of unselected) await user.click(button);

    // Should show 30 credits needed (the default scene plus two more).
    await waitFor(() => {
      expect(screen.getAllByText(/30/).length).toBeGreaterThan(0);
    });
  });
});
