// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

import EcomHistoryPage from "../src/app/(workspace)/ecom-images/history/page";

const MOCK_JOBS = [
  {
    id: "job-1",
    status: "completed" as const,
    productName: "美的空气净化器",
    sceneCount: 5,
    outputCount: 5,
    errorMessage: null,
    outputs: [
      { sceneId: "01-hero-image", url: "https://example.com/1.jpg", error: null },
      { sceneId: "02-lifestyle-scene", url: "https://example.com/2.jpg", error: null },
      { sceneId: "03-flat-lay", url: "https://example.com/3.jpg", error: null },
      { sceneId: "04-detail-macro", url: "https://example.com/4.jpg", error: null },
      { sceneId: "05-poster-banner", url: "https://example.com/5.jpg", error: null },
    ],
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    completedAt: new Date(Date.now() - 30_000).toISOString(),
  },
  {
    id: "job-2",
    status: "failed" as const,
    productName: "便携蓝牙音箱",
    sceneCount: 3,
    outputCount: 0,
    errorMessage: "Provider error",
    outputs: [
      { sceneId: "01-hero-image", url: null, error: "rate limited" },
    ],
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    completedAt: null,
  },
];

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(cleanup);

describe("EcomHistoryPage", () => {
  it("renders without throwing", () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobs: [] }),
    });
    expect(() => render(<EcomHistoryPage />)).not.toThrow();
  });

  it("shows page title and new-create CTA", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobs: [] }),
    });
    render(<EcomHistoryPage />);
    expect(
      screen.getByRole("heading", { name: /电商图生成历史/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /新建生成/ }),
    ).toBeInTheDocument();
  });

  it("renders empty state when no jobs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobs: [] }),
    });
    render(<EcomHistoryPage />);
    await waitFor(() => {
      expect(screen.getByText(/还没有生成任务/)).toBeInTheDocument();
    });
  });

  it("renders job cards from API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobs: MOCK_JOBS }),
    });
    render(<EcomHistoryPage />);
    await waitFor(() => {
      expect(screen.getByText("美的空气净化器")).toBeInTheDocument();
    });
    expect(screen.getByText("便携蓝牙音箱")).toBeInTheDocument();
  });

  it("shows status badges for completed and failed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobs: MOCK_JOBS }),
    });
    render(<EcomHistoryPage />);
    await waitFor(() => {
      expect(screen.getByText("已完成")).toBeInTheDocument();
    });
    expect(screen.getByText("失败")).toBeInTheDocument();
  });

  it("shows error alert when API fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: "Internal error" } }),
    });
    render(<EcomHistoryPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Internal error/);
    });
  });
});
