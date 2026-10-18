// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchLocalSession, mockSignOutLocal } = vi.hoisted(() => ({
  mockFetchLocalSession: vi.fn(),
  mockSignOutLocal: vi.fn(),
}));

vi.mock("../src/lib/local-auth", () => ({
  fetchLocalSession: mockFetchLocalSession,
  signOutLocal: mockSignOutLocal,
}));

import { AuthProvider, useAuth } from "../src/lib/auth-context";

function TestConsumer() {
  const { user, loading } = useAuth();
  return <div><span data-testid="loading">{String(loading)}</span><span data-testid="user">{user?.email ?? "none"}</span></div>;
}

describe("AuthProvider", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchLocalSession.mockResolvedValue({ session: null });
  });

  it("starts in loading state then resolves to no user", async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("exposes the local session user", async () => {
    mockFetchLocalSession.mockResolvedValue({ session: { access_token: "session-token", user: { id: "user_1", email: "test@test.com" } } });
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("test@test.com"));
  });
});
