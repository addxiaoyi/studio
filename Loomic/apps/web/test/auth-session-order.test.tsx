import "@testing-library/jest-dom/vitest";
import { AuthProvider, type LocalSession, useAuth } from "@/lib/auth-context";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/local-auth", () => ({
  fetchLocalSession: mocks.fetch,
  signOutLocal: mocks.signOut,
}));
const old: LocalSession = {
  access_token: "old",
  user: { id: "old-user", email: "old@example.test" },
};
const fresh: LocalSession = {
  access_token: "new",
  user: { id: "new-user", email: "new@example.test" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function State() {
  const auth = useAuth();
  return (
    <>
      <output data-testid="user">{auth.user?.id ?? "none"}</output>
      <output data-testid="loading">{String(auth.loading)}</output>
      <output data-testid="error">
        {auth.sessionError?.message ?? "none"}
      </output>
      <button type="button" onClick={() => void auth.refreshSession()}>
        refresh
      </button>
      <button type="button" onClick={() => auth.acceptSession(fresh)}>
        accept
      </button>
      <button
        type="button"
        onClick={() => void auth.signOut().catch(() => undefined)}
      >
        sign out
      </button>
    </>
  );
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.signOut.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["success", "unauthorized", "network"])(
  "does not overwrite an accepted login with an older %s lookup",
  async (kind) => {
    const lookup = deferred<{ session: LocalSession | null }>();
    mocks.fetch.mockReturnValueOnce(lookup.promise);
    render(
      <AuthProvider>
        <State />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await act(async () => {
      if (kind === "success") lookup.resolve({ session: old });
      else
        lookup.reject(
          Object.assign(
            new Error(kind),
            kind === "unauthorized" ? { status: 401 } : {},
          ),
        );
    });
    expect(screen.getByTestId("user")).toHaveTextContent("new-user");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  },
);

it("keeps loading until the newest refresh finishes and rejects the older reply", async () => {
  const first = deferred<{ session: LocalSession | null }>();
  const second = deferred<{ session: LocalSession | null }>();
  mocks.fetch
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "refresh" }));
  await act(async () => {
    first.resolve({ session: old });
  });
  expect(screen.getByTestId("loading")).toHaveTextContent("true");
  expect(screen.getByTestId("user")).toHaveTextContent("none");
  await act(async () => {
    second.resolve({ session: fresh });
  });
  expect(screen.getByTestId("user")).toHaveTextContent("new-user");
});

it("does not resurrect a signed-out user from an older session lookup", async () => {
  const lookup = deferred<{ session: LocalSession | null }>();
  mocks.fetch.mockReturnValueOnce(lookup.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
  await act(async () => {
    lookup.resolve({ session: old });
  });
  expect(screen.getByTestId("user")).toHaveTextContent("none");
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
});

it("deduplicates sign-out and prevents session refresh during its pending request", async () => {
  const logout = deferred<void>();
  mocks.fetch.mockResolvedValue({ session: old });
  mocks.signOut.mockReturnValueOnce(logout.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  await screen.findByText("old-user");
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "refresh" }));
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledOnce();
  await act(async () => {
    logout.resolve();
  });
  expect(screen.getByTestId("user")).toHaveTextContent("none");
});

it("preserves the authenticated state and exposes failure when logout fails", async () => {
  mocks.fetch.mockResolvedValue({ session: old });
  mocks.signOut.mockRejectedValueOnce(new Error("sign out unavailable"));
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  await screen.findByText("old-user");
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  await waitFor(() =>
    expect(screen.getByTestId("error")).toHaveTextContent(
      "sign out unavailable",
    ),
  );
  expect(screen.getByTestId("user")).toHaveTextContent("old-user");
});

it("reconciles the real cookie after an older logout settles behind a newer login", async () => {
  const logout = deferred<void>();
  mocks.fetch
    .mockResolvedValueOnce({ session: old })
    .mockResolvedValueOnce({ session: null });
  mocks.signOut.mockReturnValueOnce(logout.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  await screen.findByText("old-user");
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "accept" }));
  await act(async () => {
    logout.resolve();
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("user")).toHaveTextContent("none");
});

it("keeps a newer login when its cookie survives the earlier logout response", async () => {
  const logout = deferred<void>();
  mocks.fetch
    .mockResolvedValueOnce({ session: old })
    .mockResolvedValueOnce({ session: fresh });
  mocks.signOut.mockReturnValueOnce(logout.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  await screen.findByText("old-user");
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "accept" }));
  await act(async () => {
    logout.resolve();
  });
  expect(screen.getByTestId("user")).toHaveTextContent("new-user");
});

it("reports uncertainty when the cookie reconciliation fails", async () => {
  const logout = deferred<void>();
  mocks.fetch
    .mockResolvedValueOnce({ session: old })
    .mockRejectedValueOnce(new Error("session service offline"));
  mocks.signOut.mockReturnValueOnce(logout.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  await screen.findByText("old-user");
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "accept" }));
  await act(async () => {
    logout.resolve();
  });
  expect(screen.getByTestId("user")).toHaveTextContent("new-user");
  expect(screen.getByTestId("error")).toHaveTextContent(
    "session service offline",
  );
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
});

it("ignores an obsolete logout reconciliation when another login has completed", async () => {
  const logout = deferred<void>();
  const reconcile = deferred<{ session: LocalSession | null }>();
  mocks.fetch
    .mockResolvedValueOnce({ session: old })
    .mockReturnValueOnce(reconcile.promise);
  mocks.signOut.mockReturnValueOnce(logout.promise);
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  await screen.findByText("old-user");
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "accept" }));
  await act(async () => {
    logout.resolve();
  });
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "accept" }));
  await act(async () => {
    reconcile.resolve({ session: null });
  });
  expect(screen.getByTestId("user")).toHaveTextContent("new-user");
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
});
