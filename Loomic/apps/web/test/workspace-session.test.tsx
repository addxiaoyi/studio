import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceLayout from "@/app/(workspace)/layout";
const state = vi.hoisted(() => ({
  replace: vi.fn(),
  retrySession: vi.fn(),
  user: null as unknown,
  loading: false,
  sessionError: new Error("offline"),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets/",
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => state }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/desktop-workspace-sidebar", () => ({
  DesktopWorkspaceSidebar: () => null,
}));
vi.mock("@/components/credits/credit-header-button", () => ({
  CreditHeaderButton: () => null,
}));
vi.mock("@/components/page-transition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("offers session retry instead of redirecting unknown login state to sign-in", () => {
  render(
    <WorkspaceLayout>
      <p>workspace</p>
    </WorkspaceLayout>,
  );
  expect(state.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("登录状态");
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
  expect(state.retrySession).toHaveBeenCalledOnce();
});
