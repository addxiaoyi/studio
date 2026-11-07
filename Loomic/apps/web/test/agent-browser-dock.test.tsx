import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentBrowserDock } from "@/components/agent-browser/dock";
import { AgentBrowserButton } from "@/components/agent-browser/open-button";
import { AgentBrowserAccessError } from "@/lib/agent-browser-api";

const api = vi.hoisted(() => ({
  listAgentBrowsers: vi.fn(),
  readAgentBrowserFrame: vi.fn(),
  controlAgentBrowser: vi.fn(),
}));
vi.mock("@/lib/agent-browser-api", async (original) => ({
  ...(await original<typeof import("@/lib/agent-browser-api")>()),
  ...api,
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token", user: { id: "user" } } }),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => "zh-CN" }));
vi.mock("gsap", () => ({ default: { to: () => ({ kill: vi.fn() }) } }));
const session = {
  id: "00000000-0000-4000-8000-000000000001",
  taskId: "00000000-0000-4000-8000-000000000002",
  engine: "chromix",
  name: "浏览 Agent",
  title: "Example",
  url: "https://example.test/",
  state: "running",
  control: "agent",
  width: 1280,
  height: 720,
  frameRevision: 1,
  cursor: { x: 0.2, y: 0.3, visible: true, kind: "read", label: "读取标题" },
  detail: "正在读取页面",
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
beforeEach(() => {
  vi.clearAllMocks();
  api.listAgentBrowsers.mockResolvedValue({
    enabled: true,
    sessions: [session],
  });
  api.readAgentBrowserFrame.mockResolvedValue(
    new Blob(["frame"], { type: "image/jpeg" }),
  );
  api.controlAgentBrowser.mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("opens the live session from a task, pauses explicitly, and closes without canceling", async () => {
  const user = userEvent.setup();
  render(<><AgentBrowserButton/><AgentBrowserDock /></>);
  act(() =>
    window.dispatchEvent(
      new CustomEvent("loomic:show-agent-browser", {
        detail: { taskId: session.taskId },
      }),
    ),
  );
  expect(await screen.findByText("Chromix")).toBeVisible();
  expect(await screen.findByAltText("浏览器画面：Example")).toHaveAttribute(
    "src",
    "blob:preview",
  );
  await user.click(screen.getByRole("button", { name: "下一动作前暂停" }));
  expect(api.controlAgentBrowser).toHaveBeenCalledWith(
    "token",
    session.id,
    "paused",
  );
  await user.click(screen.getByRole("button", { name: "关闭浏览器侧栏" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(api.controlAgentBrowser).toHaveBeenCalledTimes(1);
});
it("clears private frames when access is revoked", async () => {
  render(<><AgentBrowserButton/><AgentBrowserDock /></>);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "展开 Agent 浏览器" }));
  await screen.findByAltText("浏览器画面：Example");
  api.listAgentBrowsers.mockRejectedValue(
    new AgentBrowserAccessError(403, "隔离浏览器权限已关闭"),
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "重新连接" }));
  await waitFor(() =>
    expect(
      screen.queryByAltText("浏览器画面：Example"),
    ).not.toBeInTheDocument(),
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
it("does not display an unrelated browser when the requested task has not started", async () => {
  render(<><AgentBrowserButton/><AgentBrowserDock /></>);
  act(() =>
    window.dispatchEvent(
      new CustomEvent("loomic:show-agent-browser", {
        detail: { taskId: "00000000-0000-4000-8000-000000000003" },
      }),
    ),
  );
  expect(await screen.findByText("还没有浏览器会话")).toBeVisible();
  expect(api.readAgentBrowserFrame).not.toHaveBeenCalled();
});

it("lets a slow frame finish while newer frame metadata arrives",async()=>{
  let revision=1,deliver:(blob:Blob)=>void=()=>{};
  api.listAgentBrowsers.mockImplementation(async()=>({enabled:true,sessions:[{...session,frameRevision:revision++}]}));
  api.readAgentBrowserFrame.mockImplementation(()=>new Promise<Blob>(resolve=>{deliver=resolve;}));
  render(<><AgentBrowserButton/><AgentBrowserDock/></>);await userEvent.setup().click(screen.getByRole("button",{name:"展开 Agent 浏览器"}));
  await waitFor(()=>expect(api.readAgentBrowserFrame).toHaveBeenCalled());
  const signal=api.readAgentBrowserFrame.mock.calls[0]![2] as AbortSignal;
  const reads=api.listAgentBrowsers.mock.calls.length;
  await waitFor(()=>expect(api.listAgentBrowsers.mock.calls.length).toBeGreaterThan(reads),{timeout:3000});
  expect(signal.aborted).toBe(false);
  await act(async()=>deliver(new Blob(["frame"],{type:"image/jpeg"})));
  expect(await screen.findByAltText("浏览器画面：Example")).toBeVisible();
});
