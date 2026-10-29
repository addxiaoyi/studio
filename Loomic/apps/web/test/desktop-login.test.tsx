// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopAppEntry from "@/app/desktop-app/page";
import LegacyDesktopPage from "@/app/desktop/page";

const mocks = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, session: null as { access_token: string } | null, loading: false },
  replace: vi.fn(),
  push: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => mocks.search,
  usePathname: () => "/desktop-app/",
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/components/desktop-workbench", () => ({
  DesktopWorkbench: () => <div>workbench</div>,
}));

beforeEach(() => {
  document.documentElement.lang = "zh-CN";
  // The shell only renders inside the desktop container.
  document.documentElement.dataset.helsteraDesktop = "true";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
  mocks.auth.user = null;
  mocks.auth.session = null;
  mocks.auth.loading = false;
  delete document.documentElement.dataset.helsteraDesktop;
  mocks.search = new URLSearchParams();
});

function setDesktopApi(api: object = {
  startBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
  cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
  getBrowserLoginStatus: vi.fn().mockResolvedValue({ status: "idle" }),
  connectEmbeddedAssistant: vi.fn().mockResolvedValue({ ok: true }),
  openBrowserPairing: vi.fn().mockResolvedValue({ ok: true, url: "" }),
  onBrowserLoginState: vi.fn().mockReturnValue(vi.fn()),
}) {
  Object.defineProperty(window, "electronAPI", { configurable: true, value: api });
}

describe("desktop login handoff", () => {
  it("opens the system browser, shows the waiting state, and can cancel", async () => {
    let onState: ((event: { status: "waiting" }) => void) | undefined;
    const api = {
      startBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      getBrowserLoginStatus: vi.fn().mockResolvedValue({ status: "idle" }),
      connectEmbeddedAssistant: vi.fn().mockResolvedValue({ ok: true }),
      openBrowserPairing: vi.fn().mockResolvedValue({ ok: true, url: "" }),
      onBrowserLoginState: vi.fn((callback: (event: { status: "waiting" }) => void) => {
        onState = callback;
        return vi.fn();
      }),
    };
    setDesktopApi(api);
    render(<DesktopAppEntry />);

    fireEvent.click(await screen.findByRole("button", { name: /登录并进入工作台/ }));
    await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledOnce());

    onState?.({ status: "waiting" });
    expect(await screen.findByRole("status")).toHaveTextContent("已打开系统浏览器");

    fireEvent.click(await screen.findByRole("button", { name: "取消登录" }));
    await waitFor(() => expect(api.cancelBrowserLogin).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "重新发起登录" })).toBeEnabled();
  });

  it("surfaces a handoff failure so the user can retry", async () => {
    const api = {
      startBrowserLogin: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, message: "桌面协议未注册" })
        .mockResolvedValueOnce({ ok: true }),
      cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      getBrowserLoginStatus: vi.fn().mockResolvedValue({ status: "idle" }),
      connectEmbeddedAssistant: vi.fn().mockResolvedValue({ ok: true }),
      openBrowserPairing: vi.fn().mockResolvedValue({ ok: true, url: "" }),
      onBrowserLoginState: vi.fn().mockReturnValue(vi.fn()),
    };
    setDesktopApi(api);
    render(<DesktopAppEntry />);

    fireEvent.click(await screen.findByRole("button", { name: /登录并进入工作台/ }));
    await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledOnce());

    expect(await screen.findByRole("alert")).toHaveTextContent("桌面协议未注册");

    fireEvent.click(await screen.findByRole("button", { name: "重新发起登录" }));
    await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledTimes(2));
  });
});

describe("retired /desktop/ shell", () => {
  it("forwards a legacy ?mode= link into the current shell", async () => {
    mocks.search = new URLSearchParams("mode=projects");
    render(<LegacyDesktopPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/desktop-app/projects/"));
  });

  it("forwards unknown or missing modes to the desktop home", async () => {
    render(<LegacyDesktopPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/desktop-app/"));
  });
});
