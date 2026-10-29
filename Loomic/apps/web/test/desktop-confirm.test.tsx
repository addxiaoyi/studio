// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopConfirmPage from "../src/app/auth/desktop-confirm/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  confirmDesktopLogin: vi.fn(() => new Promise<string>(() => {})),
  auth: { user: null as { email: string } | null, loading: false },
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.search,
}));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("../src/lib/local-auth", () => ({
  confirmDesktopLogin: mocks.confirmDesktopLogin,
}));
vi.mock("../src/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("../src/components/loading-screen", () => ({
  LoadingScreen: () => <div role="status">Loading</div>,
}));
vi.mock("../src/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.search = new URLSearchParams();
  mocks.auth.user = null;
  mocks.auth.loading = false;
});

describe("desktop confirmation login handoff", () => {
  it("preserves the loopback callback through website sign-in", async () => {
    const callback = "http://127.0.0.1:43821/callback";
    mocks.search = new URLSearchParams({ state: "s".repeat(43), callback });

    render(<DesktopConfirmPage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
    const [loginPath] = mocks.replace.mock.calls[0] ?? [];
    expect(loginPath).toBeDefined();
    const loginUrl = new URL(loginPath!, "https://studio.0st.top");
    const redirectUrl = new URL(loginUrl.searchParams.get("redirect")!, "https://studio.0st.top");
    expect(loginUrl.pathname).toBe("/login/");
    expect(loginUrl.searchParams.get("desktop")).toBe("1");
    expect(redirectUrl.pathname).toBe("/auth/desktop-confirm/");
    expect(redirectUrl.searchParams.get("state")).toBe("s".repeat(43));
    expect(redirectUrl.searchParams.get("callback")).toBe(callback);
  });

  it("confirms with the desktop loopback callback after sign-in", async () => {
    const state = "s".repeat(43);
    const callback = "http://127.0.0.1:43821/callback";
    mocks.search = new URLSearchParams({ state, callback });
    mocks.auth.user = { email: "user@example.com" };

    render(<DesktopConfirmPage />);
    fireEvent.click(await screen.findByRole("button", { name: /确认此账号登录桌面端|confirm/i }));

    await waitFor(() => expect(mocks.confirmDesktopLogin).toHaveBeenCalledWith(state, callback));
  });
});
