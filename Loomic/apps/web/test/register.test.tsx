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
  mockReplace,
} = vi.hoisted(() => ({
  mockFetchLocalSession: vi.fn().mockResolvedValue({ session: null }),
  mockRegisterLocal: vi.fn().mockResolvedValue({ access_token: "session-token" }),
  mockReplace: vi.fn(),
}));

vi.mock("../src/lib/local-auth", () => ({
  fetchLocalSession: mockFetchLocalSession,
  registerLocal: mockRegisterLocal,
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockReplace })),
}));

import RegisterPage from "../src/app/register/page";
import { AuthProvider } from "../src/lib/auth-context";

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

    fireEvent.change(await screen.findByLabelText(/^email$|邮箱/i), {
      target: { value: "new-user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$|密码/i), {
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
      expect(mockRegisterLocal).toHaveBeenCalledWith("new-user@example.com", mockPassword);
    });
    expect(mockReplace).toHaveBeenCalledWith("/home");
  });

  it("keeps the local session flow independent from viewer bootstrap", async () => {
    render(
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/^email$|邮箱/i), {
      target: { value: "new-user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$|密码/i), {
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
      expect(mockRegisterLocal).toHaveBeenCalledWith("new-user@example.com", mockPassword);
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });
});
