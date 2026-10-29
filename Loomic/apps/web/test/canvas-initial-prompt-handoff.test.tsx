// @vitest-environment jsdom
/**
 * P0-U2 — the goal typed on the home screen arrives as `?prompt=`. It used to be
 * stripped from the URL on mount, so when the socket was still down the auto-send
 * effect bailed out silently and the user's goal was gone for good.
 *
 * New contract: the URL (plus a sessionStorage stash that survives the intermediate
 * `?session=` / `?id=` rewrites) keeps the goal until the send pipeline confirms the
 * handoff; only then is the parameter removed.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROMPT = "介绍这个网站的主要功能";
const STASH_KEY = "helstera:pending-initial-prompt";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: new URLSearchParams(),
  fetchCanvas: vi.fn(),
  fetchProject: vi.fn(),
  fetchWorkspaceSettings: vi.fn(),
  chatProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => mocks.search,
  usePathname: () => "/desktop-app/canvas/",
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "maker@example.com" },
    session: { access_token: "token" },
    loading: false,
    sessionError: null,
    retrySession: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    connected: false,
    startRun: vi.fn(),
    cancelRun: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    registerRPC: vi.fn(() => () => {}),
    resumeCanvas: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-job-fallback-polling", () => ({
  useJobFallbackPolling: () => ({ checkForTimedOutJobs: vi.fn() }),
}));

vi.mock("@/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  fetchCanvas: mocks.fetchCanvas,
  fetchProject: mocks.fetchProject,
  fetchWorkspaceSettings: mocks.fetchWorkspaceSettings,
  createProject: vi.fn(),
  deleteEmptyProject: vi.fn(),
}));

vi.mock("@/lib/canvas-elements", () => ({
  createExcalidrawImageElement: vi.fn(),
  insertImageOnCanvas: vi.fn(),
  insertVideoOnCanvas: vi.fn(),
}));

vi.mock("@/components/canvas-editor", () => ({
  CanvasEditor: () => <div data-testid="canvas-editor" />,
}));

vi.mock("@/components/loading-screen", () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));

vi.mock("@/components/chat-sidebar", () => ({
  ChatSidebar: (props: Record<string, unknown>) => {
    mocks.chatProps.current = props;
    return <div data-testid="chat-sidebar" />;
  },
}));

vi.mock("@/components/canvas-empty-hint", () => ({ CanvasEmptyHint: () => null }));
vi.mock("@/components/canvas-logo-menu", () => ({ CanvasLogoMenu: () => null }));
vi.mock("@/components/editable-project-name", () => ({ EditableProjectName: () => null }));
vi.mock("@/components/brand-kit-selector", () => ({ BrandKitSelector: () => null }));
vi.mock("@/components/canvas-bottom-bar", () => ({ CanvasBottomBar: () => null }));
vi.mock("@/components/canvas-files-panel", () => ({ CanvasFilesPanel: () => null }));
vi.mock("@/components/canvas-layers-panel", () => ({ CanvasLayersPanel: () => null }));
vi.mock("@/components/canvas-timeline-panel", () => ({ CanvasTimelinePanel: () => null }));
vi.mock("@/components/credits/credit-header-button", () => ({ CreditHeaderButton: () => null }));

import CanvasPage from "../src/app/canvas/page";

// jsdom in this workspace has no Web Storage, while the canvas page (via
// `desktop-canvas.ts`) and the prompt stash both use it. Install a minimal one.
function installStorage(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() { return store.size; },
    } satisfies Storage,
  });
}

function primeCanvasRequests() {
  mocks.fetchCanvas.mockResolvedValue({
    canvas: {
      id: "canvas-1",
      name: "Untitled",
      projectId: "project-1",
      content: { elements: [], appState: {}, files: {} },
    },
  });
  mocks.fetchProject.mockResolvedValue({ project: { id: "project-1", name: "Untitled", brand_kit_id: null } });
  mocks.fetchWorkspaceSettings.mockResolvedValue({ settings: { autoDeleteEmptyCanvas: false } });
}

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
  mocks.replace.mockReset();
  primeCanvasRequests();
  mocks.search = new URLSearchParams(`id=canvas-1&prompt=${encodeURIComponent(PROMPT)}&browserMode=isolated_browser`);
  mocks.chatProps.current = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("canvas page initial prompt handoff", () => {
  it("keeps the goal in the URL and in the stash while the send pipeline has not taken it", async () => {
    render(<CanvasPage />);
    await screen.findByTestId("chat-sidebar");

    // The URL is the only durable copy, so a mount must not rewrite it away.
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(STASH_KEY)).toBe(PROMPT);
    expect(mocks.chatProps.current?.initialPrompt).toBe(PROMPT);
  });

  it("removes the parameter and the stash once the goal was handed to the send pipeline", async () => {
    render(<CanvasPage />);
    await screen.findByTestId("chat-sidebar");

    const handoff = mocks.chatProps.current?.onInitialPromptHandoff as (outcome: string) => void;
    expect(typeof handoff).toBe("function");
    act(() => handoff("sent"));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    expect(mocks.replace.mock.calls[0]?.[0]).toBe("/desktop-app/canvas/?id=canvas-1&browserMode=isolated_browser");
    expect(window.sessionStorage.getItem(STASH_KEY)).toBeNull();
  });

  it("also clears the URL when the user explicitly dismisses the pending goal", async () => {
    render(<CanvasPage />);
    await screen.findByTestId("chat-sidebar");

    const handoff = mocks.chatProps.current?.onInitialPromptHandoff as (outcome: string) => void;
    act(() => handoff("dismissed"));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(STASH_KEY)).toBeNull();
  });

  it("recovers the goal from the stash when an intermediate rewrite stripped it from the URL", async () => {
    window.sessionStorage.setItem(STASH_KEY, PROMPT);
    mocks.search = new URLSearchParams("id=canvas-1&session=session-1");
    render(<CanvasPage />);

    await screen.findByTestId("chat-sidebar");
    expect(mocks.chatProps.current?.initialPrompt).toBe(PROMPT);
    // Nothing to strip: the URL never carried it.
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not stash or pass a goal when the canvas was opened without one", async () => {
    mocks.search = new URLSearchParams("id=canvas-1");
    render(<CanvasPage />);

    await screen.findByTestId("chat-sidebar");
    expect(mocks.chatProps.current?.initialPrompt).toBeUndefined();
    expect(window.sessionStorage.getItem(STASH_KEY)).toBeNull();
  });
});
