// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const { user, loading, refreshSession, acceptSession } = useAuth();
  return <div>
    <span data-testid="loading">{String(loading)}</span>
    <span data-testid="user">{user?.email ?? "none"}</span>
    <button onClick={() => void refreshSession()}>refresh</button>
    <button onClick={() => acceptSession({ access_token: "desktop-session", user: { id: "user_2", email: "desktop@test.com" } })}>accept</button>
  </div>;
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

  it("refreshes the session after an in-app login exchange", async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    mockFetchLocalSession.mockResolvedValueOnce({
      session: { access_token: "desktop-session", user: { id: "user_2", email: "desktop@test.com" } },
    });

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("desktop@test.com"));
    expect(mockFetchLocalSession).toHaveBeenCalledTimes(2);
  });

  it("updates auth state immediately after a desktop token exchange", async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    expect(screen.getByTestId("user").textContent).toBe("desktop@test.com");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
