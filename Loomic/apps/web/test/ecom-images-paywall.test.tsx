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
      .filter((b) => b.className.includes("rounded-xl"))[0]!;
    await user.click(sceneBtn);

    const genBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(genBtn).toBeDisabled();
  });

  it("shows '充值积分' link to settings when insufficient", async () => {
    mockBalance = 5;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    const sceneBtn = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("rounded-xl"))[0]!;
    await user.click(sceneBtn);

    const topUpLink = screen.getByRole("link", { name: /充值积分/ });
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
      .filter((b) => b.className.includes("rounded-xl"))[0]!;
    await user.click(sceneBtn);

    expect(screen.getByText(/可用积分/)).toBeInTheDocument();
    expect(screen.getByText(/本次预计消耗/)).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("enables generate button when user has enough credits", async () => {
    mockBalance = 1000;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    const sceneBtn = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("rounded-xl"))[0]!;
    await user.click(sceneBtn);

    const genBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(genBtn).toBeEnabled();
    // No top-up link shown when affordable
    expect(
      screen.queryByRole("link", { name: /充值积分/ }),
    ).not.toBeInTheDocument();
  });

  it("scales credit cost with scene count", async () => {
    mockBalance = 1000;
    const user = userEvent.setup();
    render(<EcomImagesPage />);

    await user.type(screen.getByPlaceholderText(/美的空气净化器/), "test");
    // Select 3 scenes
    const sceneButtons = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("rounded-xl"));
    await user.click(sceneButtons[0]!);
    await user.click(sceneButtons[1]!);
    await user.click(sceneButtons[2]!);

    // Should show 30 credits needed
    await waitFor(() => {
      expect(screen.getByText("30")).toBeInTheDocument();
    });
  });
});
