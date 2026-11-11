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

const mockPassword = "MOCK" + "_PASSWORD";

const {
  mockFetchLocalSession,
  mockRegisterLocal,
  mockRequestCode,
  mockReplace,
} = vi.hoisted(() => ({
  mockFetchLocalSession: vi.fn().mockResolvedValue({ session: null }),
  mockRegisterLocal: vi.fn().mockResolvedValue({ access_token: "session-token", user: { id: "new-user", email: "new-user@example.com" } }),
  mockRequestCode: vi.fn().mockResolvedValue(undefined),
  mockReplace: vi.fn(),
}));

vi.mock("../src/lib/local-auth", () => ({
  fetchLocalSession: mockFetchLocalSession,
  registerLocal: mockRegisterLocal,
  requestLocalCode: mockRequestCode,
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockReplace })),
}));

import RegisterPage from "../src/app/register/page";
import { AuthProvider, useAuth } from "../src/lib/auth-context";

function SessionProbe() {
  return <output data-testid="registered-session">{useAuth().user?.email}</output>;
}

describe("Register page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a local account and redirects", async () => {
    render(
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/^email$|^邮箱$/i), {
      target: { value: "new-user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send code|发送验证码/i }));
    await waitFor(() => expect(mockRequestCode).toHaveBeenCalledWith("new-user@example.com"));
    fireEvent.change(screen.getByLabelText(/enter your email code|输入邮箱验证码/i), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/^password$|^密码$/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password|确认密码/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: /create( your)? account|创建账号/i }),
    );

    await waitFor(() => {
      expect(mockRegisterLocal).toHaveBeenCalledWith("new-user@example.com", mockPassword, "123456");
    });
    expect(mockReplace).toHaveBeenCalledWith("/home");
  });

  it("keeps the local session flow independent from viewer bootstrap", async () => {
    render(
      <AuthProvider>
        <RegisterPage />
        <SessionProbe />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/^email$|^邮箱$/i), {
      target: { value: "new-user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/enter your email code|输入邮箱验证码/i), { target: { value: "654321" } });
    fireEvent.change(screen.getByLabelText(/^password$|^密码$/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password|确认密码/i), {
      target: { value: "MOCK_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: /create( your)? account|创建账号/i }),
    );

    await waitFor(() => {
      expect(mockRegisterLocal).toHaveBeenCalledWith("new-user@example.com", mockPassword, "654321");
      expect(mockReplace).toHaveBeenCalledWith("/home");
      expect(screen.getByTestId("registered-session")).toHaveTextContent("new-user@example.com");
    });
  });

  it("shows send failures and keeps the entered email available to retry", async () => {
    mockRequestCode.mockRejectedValueOnce(new Error("邮件服务暂不可用"));
    render(<AuthProvider><RegisterPage /></AuthProvider>);
    const email = await screen.findByLabelText(/^email$|^邮箱$/i);
    fireEvent.change(email, { target: { value: "retry@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /send code|发送验证码/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("邮件服务暂不可用");
    expect(email).toHaveValue("retry@example.test");
    expect(mockRegisterLocal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /send code|发送验证码/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("retry@example.test");
    expect(mockRequestCode).toHaveBeenCalledTimes(2);
    const code = screen.getByLabelText(/enter your email code|输入邮箱验证码/i);
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.change(email, { target: { value: "another@example.test" } });
    expect(code).toHaveValue("");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
