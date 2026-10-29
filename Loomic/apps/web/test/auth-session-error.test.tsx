// @vitest-environment jsdom
/**
 * P0-U1 — a network failure while reading the session must never look like
 * "signed out". `refreshSession` used to be `try/finally` with no `catch`, so the
 * thrown error vanished, `user` stayed null and every shell rendered the login page.
 */
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
  const { user, loading, sessionError, retrySession } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.email ?? "none"}</span>
      <span data-testid="error">{sessionError ? sessionError.message : "none"}</span>
      <button onClick={() => void retrySession()}>retry-session</button>
    </div>
  );
}

function networkFailure() {
  return new TypeError("Failed to fetch");
}

function unauthorizedFailure() {
  return Object.assign(new Error("无法读取登录状态"), { status: 401 });
}

describe("AuthProvider session failure handling", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchLocalSession.mockResolvedValue({ session: null });
  });

  it("surfaces a network failure instead of dropping it", async () => {
    mockFetchLocalSession.mockRejectedValueOnce(networkFailure());
    render(<AuthProvider><TestConsumer /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("error").textContent).toBe("Failed to fetch");
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("clears the error and loads the user when the session is retried", async () => {
    mockFetchLocalSession.mockRejectedValueOnce(networkFailure());
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Failed to fetch"));

    mockFetchLocalSession.mockResolvedValueOnce({
      session: { access_token: "session-token", user: { id: "user_1", email: "test@test.com" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "retry-session" }));

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("test@test.com"));
    expect(screen.getByTestId("error").textContent).toBe("none");
    expect(mockFetchLocalSession).toHaveBeenCalledTimes(2);
  });

  it("keeps an already signed-in user when a later refresh fails", async () => {
    mockFetchLocalSession.mockResolvedValueOnce({
      session: { access_token: "session-token", user: { id: "user_1", email: "test@test.com" } },
    });
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("test@test.com"));

    mockFetchLocalSession.mockRejectedValueOnce(networkFailure());
    fireEvent.click(screen.getByRole("button", { name: "retry-session" }));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Failed to fetch"));
    // A dropped connection must not sign the user out.
    expect(screen.getByTestId("user").textContent).toBe("test@test.com");
  });

  it("treats a 401 as a real signed-out answer, not a connection failure", async () => {
    mockFetchLocalSession.mockRejectedValueOnce(unauthorizedFailure());
    render(<AuthProvider><TestConsumer /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("error").textContent).toBe("none");
    expect(screen.getByTestId("user").textContent).toBe("none");
  });
});
