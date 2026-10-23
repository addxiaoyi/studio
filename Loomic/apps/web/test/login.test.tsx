// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockToken = "session" + "-token";
const mockPassword = "MOCK" + "_PASSWORD";

const {
  mockFetchLocalSession,
  mockRequestLocalCode,
  mockVerifyLocalCode,
  mockSignInLocalWithPassword,
  mockStartBrowserLogin,
  mockCancelBrowserLogin,
  mockOnBrowserLoginState,
  mockReplace,
  mockSearchParams,
} = vi.hoisted(() => ({
  mockFetchLocalSession: vi.fn().mockResolvedValue({ session: null }),
  mockRequestLocalCode: vi.fn().mockResolvedValue(undefined),
  mockVerifyLocalCode: vi
    .fn()
    .mockResolvedValue({ access_token: "session-token" }),
  mockSignInLocalWithPassword: vi
    .fn()
    .mockResolvedValue({ access_token: "session-token" }),
  mockStartBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
  mockCancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
  mockOnBrowserLoginState: vi.fn().mockReturnValue(vi.fn()),
  mockReplace: vi.fn(),
  mockSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("../src/lib/local-auth", () => ({
  fetchLocalSession: mockFetchLocalSession,
  requestLocalCode: mockRequestLocalCode,
  verifyLocalCode: mockVerifyLocalCode,
  signInLocalWithPassword: mockSignInLocalWithPassword,
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockReplace })),
  useSearchParams: mockSearchParams,
}));

import LoginPage from "../src/app/login/page";
import { AuthProvider } from "../src/lib/auth-context";

describe("Login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete document.documentElement.dataset.helsteraDesktop;
    mockSearchParams.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.helsteraDesktop;
    Reflect.deleteProperty(window, "electronAPI");
  });

  it("renders split screen with brand panel and login form", async () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    expect((await screen.findByText("Helstera")).textContent).toBe("Helstera");
    expect(
      screen.getByRole("button", { name: /send code|发送验证码/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Continue with Google/i)).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: /create one|创建账户/i })
        .getAttribute("href"),
    ).toBe("/register");
  });

  it("shows callback errors from the query string as a banner", async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams("error=auth_exchange_failed"),
    );

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This sign-in link could not be verified. Request a new one and try again.",
    );
  });

  it("sends a local verification code", async () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /send code|发送验证码/i }),
    );

    await waitFor(() => {
      expect(mockRequestLocalCode).toHaveBeenCalledWith("user@example.com");
    });
  });

  it("redirects after local password sign-in", async () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: /use password instead|使用密码登录/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^(sign in|登录)$/i }));

    await waitFor(() => {
      expect(mockSignInLocalWithPassword).toHaveBeenCalledWith(
        "user@example.com",
        mockPassword,
      );
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });

  it("returns to the requested workspace path after sign-in", async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams("redirect=%2Ffeed%3Fstep%3D2"),
    );
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    await screen.findByRole("button", { name: /send code|发送验证码/i });
    fireEvent.click(
      screen.getByRole("button", {
        name: /use password instead|使用密码登录/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^(sign in|登录)$/i }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/feed?step=2"),
    );
  });

  it("uses only the system browser login flow in the desktop shell", async () => {
    document.documentElement.dataset.helsteraDesktop = "true";
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        startBrowserLogin: mockStartBrowserLogin,
        cancelBrowserLogin: mockCancelBrowserLogin,
        onBrowserLoginState: mockOnBrowserLoginState,
      },
    });
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    const login = await screen.findByRole("button", { name: /^登录$/ });
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /create one|创建账户/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(login);
    await waitFor(() => expect(mockStartBrowserLogin).toHaveBeenCalledOnce());
    const cancel = await screen.findByRole("button", { name: /取消登录/ });
    fireEvent.click(cancel);
    await waitFor(() => expect(mockCancelBrowserLogin).toHaveBeenCalledOnce());
  });

  it("keeps normal login in the system browser for a desktop confirmation redirect", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("desktop=1"));
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /send code|发送验证码/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email|邮箱/i)).toBeInTheDocument();
    expect(screen.queryByText(/桌面登录组件未启动/)).not.toBeInTheDocument();
  });

  it("preserves the desktop confirmation redirect after browser sign-in", async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams(
        "desktop=1&redirect=%2Fauth%2Fdesktop-confirm%2F%3Fstate%3Dstate-1",
      ),
    );
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await screen.findByRole("button", { name: /send code|发送验证码/i });
    fireEvent.click(
      screen.getByRole("button", {
        name: /use password instead|使用密码登录/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/email|邮箱/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password|密码/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^(sign in|登录)$/i }));

    await waitFor(() => {
      expect(mockSignInLocalWithPassword).toHaveBeenCalledOnce();
      expect(mockReplace).toHaveBeenCalledWith(
        "/auth/desktop-confirm/?state=state-1",
      );
    });
  });
});
