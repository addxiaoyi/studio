// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "test-token" } }) }));
vi.mock("@/components/desktop-connection-banner", () => ({ DesktopConnectionBanner: () => null }));
vi.mock("@/components/desktop-toast", () => ({ DesktopToastProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/desktop-extension-bridge", () => ({
  DesktopExtensionBridge: ({ accessToken }: { accessToken: string }) => {
    useEffect(() => {
      lifecycle.mount(accessToken);
      return () => lifecycle.unmount();
    }, [accessToken]);
    return null;
  },
}));

import DesktopAppLayout from "@/app/desktop-app/layout";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("keeps extension synchronization mounted while desktop pages change", () => {
  const layout = render(<DesktopAppLayout><div>Home</div></DesktopAppLayout>);
  layout.rerender(<DesktopAppLayout><div>MCP</div></DesktopAppLayout>);
  layout.rerender(<DesktopAppLayout><div>Marketplace</div></DesktopAppLayout>);
  expect(lifecycle.mount).toHaveBeenCalledTimes(1);
  expect(lifecycle.mount).toHaveBeenCalledWith("test-token");
  expect(lifecycle.unmount).not.toHaveBeenCalled();
  layout.unmount();
  expect(lifecycle.unmount).toHaveBeenCalledTimes(1);
});
