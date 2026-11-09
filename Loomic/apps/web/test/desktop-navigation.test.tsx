import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopWorkspaceSidebar } from "@/components/desktop-workspace-sidebar";
const navigation = vi.hoisted(() => ({
  path: "/desktop-app/mcp/",
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => navigation,
}));
vi.mock("@/components/agent-browser/open-button", () => ({
  AgentBrowserButton: () => <button type="button">浏览器</button>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens the active desktop section and routes settings to local capabilities", () => {
  render(<DesktopWorkspaceSidebar />);
  expect(screen.getByRole("button", { name: "MCP 工具" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: /设置/ }));
  expect(navigation.push).toHaveBeenCalledWith("/desktop-app/settings/");
  expect(screen.getByRole("button", { name: "扩展市场" })).toBeVisible();
  expect(screen.getByRole("button", { name: "任务历史" })).toBeVisible();
});
