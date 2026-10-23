// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopPage from "@/app/desktop/page";

const mocks = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, loading: false },
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/components/desktop-workbench", () => ({
  DesktopWorkbench: () => <div>workbench</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
  mocks.auth.user = null;
  mocks.auth.loading = false;
});

function setDesktopApi(api: object = {
  startBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
  cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
  onBrowserLoginState: vi.fn().mockReturnValue(vi.fn()),
}) {
  Object.defineProperty(window, "electronAPI", { configurable: true, value: api });
}

describe("desktop login handoff", () => {
  it("shows the waiting state, cancels the request, and allows retry", async () => {
    let onState: ((event: { status: "waiting" | "expired" }) => void) | undefined;
    const api = {
      startBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      onBrowserLoginState: vi.fn((callback) => {
        onState = callback;
        return vi.fn();
      }),
    };
    setDesktopApi(api);
    render(<DesktopPage />);

    fireEvent.click(screen.getByRole("button", { name: /登录并进入工作台/ }));
    await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledOnce());
    onState?.({ status: "waiting" });
    expect(await screen.findByRole("status")).toHaveTextContent("已打开系统浏览器");

    fireEvent.click(screen.getByRole("button", { name: "取消登录" }));
    await waitFor(() => expect(api.cancelBrowserLogin).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("登录已取消");
    expect(screen.getByRole("button", { name: "重新发起登录" })).toBeEnabled();
  });

  it("shows expiry and surfaces errors so the user can retry", async () => {
    let onState: ((event: { status: "expired" }) => void) | undefined;
    const api = {
      startBrowserLogin: vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, message: "桌面协议未注册" }),
      cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      onBrowserLoginState: vi.fn((callback: (event: { status: "expired" }) => void) => {
        onState = callback;
        return vi.fn();
      }),
    };
    setDesktopApi(api);
    render(<DesktopPage />);

    fireEvent.click(screen.getByRole("button", { name: /登录并进入工作台/ }));
    await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledOnce());
    onState?.({ status: "expired" });
    expect(await screen.findByRole("status")).toHaveTextContent("登录请求已过期");

    fireEvent.click(screen.getByRole("button", { name: "重新发起登录" }));
    await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("桌面协议未注册");
  });

  it("keeps the desktop-only frontend hidden from a regular website browser", async () => {
    Reflect.deleteProperty(window, "electronAPI");
    render(<DesktopPage />);
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/home/");
  });
});
