import "@testing-library/jest-dom/vitest";
import { AppSidebar } from "@/components/app-sidebar";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({
  pathname: null as string | null,
  signOut: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), replace: route.replace }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: null, signOut: route.signOut }),
}));
vi.mock("@/lib/server-api", () => ({ fetchViewer: vi.fn() }));
vi.mock("@/components/credits/credit-balance", () => ({
  CreditBalance: () => null,
}));
vi.mock("@/components/agent-browser/open-button", () => ({
  AgentBrowserButton: () => null,
}));
afterEach(() => {
  cleanup();
  route.pathname = null;
  route.signOut.mockReset();
  route.replace.mockReset();
});

it("shows a failed logout and stays in the workspace until retry succeeds", async () => {
  route.signOut
    .mockRejectedValueOnce(new Error("退出登录失败，请重试。"))
    .mockResolvedValueOnce(undefined);
  render(<AppSidebar />);
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败");
  expect(route.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await waitFor(() => expect(route.replace).toHaveBeenCalledWith("/login"));
});

it("keeps actual sidebar links usable while the router pathname is unresolved", () => {
  const { rerender } = render(<AppSidebar />);
  expect(
    screen.getAllByRole("link", { name: "工作台" }).length,
  ).toBeGreaterThan(0);
  expect(document.querySelector('a[aria-current="page"]')).toBeNull();
  route.pathname = "/assets";
  rerender(<AppSidebar />);
  expect(
    document.querySelector('a[href="/assets"][aria-current="page"]'),
  ).not.toBeNull();
});
