// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../src/components/toast";

// Mock window.open once globally
const mockOpen = vi.fn(() => ({ location: { href: "" }, close: vi.fn() }));
Object.defineProperty(window, "open", {
  writable: true,
  value: mockOpen,
});

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRouter = { push: mockPush, replace: mockReplace };
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => mockRouter),
}));

const mockSignOut = vi.fn();
const mockUser = { id: "u1", email: "test@test.com" };
const mockSession = { access_token: "token_" + "123" };
const mockAuthValue = {
  user: mockUser,
  session: mockSession,
  loading: false,
  signOut: mockSignOut,
};
vi.mock("../src/lib/auth-context", () => ({
  useAuth: vi.fn(() => mockAuthValue),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import ProjectsPage from "../src/app/(workspace)/projects/page";

const viewerResponse = {
  profile: { id: "u1", email: "test@test.com", displayName: "Test", avatarUrl: null },
  workspace: { id: "w1", name: "My Workspace", type: "personal", ownerUserId: "u1" },
  membership: { workspaceId: "w1", userId: "u1", role: "owner" },
};

const workspace = { id: "w1", name: "My Workspace", type: "personal", ownerUserId: "u1" };

const projectsResponse = {
  projects: [
    {
      id: "p1", name: "Brand System", slug: "brand-system",
      description: "Primary brand project",
      workspace, primaryCanvas: { id: "c1", name: "Main Canvas", isPrimary: true },
      createdAt: "2026-03-23T00:00:00Z", updatedAt: "2026-03-23T10:00:00Z",
    },
    {
      id: "p2", name: "App Redesign", slug: "app-redesign",
      description: null,
      workspace, primaryCanvas: { id: "c2", name: "Main Canvas", isPrimary: true },
      createdAt: "2026-03-22T00:00:00Z", updatedAt: "2026-03-22T00:00:00Z",
    },
  ],
};

const untrackedProjectResponse = {
  project: {
    id: "p-untagged",
    name: "Untitled",
    slug: "untitled",
    description: null,
    workspace: workspace,
    primaryCanvas: { id: "c-untagged", name: "Untitled Canvas", isPrimary: true },
    createdAt: "2026-03-23T00:00:00Z",
    updatedAt: "2026-03-23T00:00:00Z",
  },
};

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
});

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockSignOut.mockReset();
  mockOpen.mockClear();
});

afterEach(() => {
  cleanup();
});

function mockSuccessLoad(projectsOverride?: unknown) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/api/viewer")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => viewerResponse });
    }
    if (url.includes("/api/projects")) {
      if (init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 200, json: async () => untrackedProjectResponse });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (projectsOverride ?? projectsResponse),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

describe("Projects page", () => {
  it("renders project list", async () => {
    mockSuccessLoad();
    render(<ProjectsPage />, { wrapper: ToastProvider });

    // Project names appear in the project grid
    expect(await screen.findByText("Brand System")).toBeInTheDocument();
    expect(screen.getByText("App Redesign")).toBeInTheDocument();

    // New project button (localized)
    expect(
      await screen.findByRole("button", { name: /新建项目/i }),
    ).toBeInTheDocument();
  });

  it("shows create project button when no projects", async () => {
    mockSuccessLoad({ projects: [] });
    render(<ProjectsPage />, { wrapper: ToastProvider });

    // Button contains the text "新建项目"
    const button = await screen.findByRole("button");
    expect(button).toHaveTextContent("新建项目");
  });

  it("creates untracked project on + 新建项目 click - success path", async () => {
    mockSuccessLoad();
    render(<ProjectsPage />, { wrapper: ToastProvider });

    const button = await screen.findByRole("button", { name: /新建项目/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });
  });

  it("redirects to login on 401 unauthorized during project creation", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/viewer")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => viewerResponse });
      }
      if (url.includes("/api/projects")) {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: false, status: 401,
            json: async () => ({ error: { code: "unauthorized", message: "Bad token" } }),
          });
        }
        // GET /api/projects - return success
        return Promise.resolve({ ok: true, status: 200, json: async () => projectsResponse });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(<ProjectsPage />, { wrapper: ToastProvider });

    const button = await screen.findByRole("button", { name: /新建项目/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("shows error toast on 500 during project creation", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/viewer")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => viewerResponse });
      }
      if (url.includes("/api/projects")) {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: false, status: 500,
            json: async () => ({ error: { code: "project_create_failed", message: "Create failed." } }),
          });
        }
        // GET /api/projects - return success
        return Promise.resolve({ ok: true, status: 200, json: async () => projectsResponse });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(<ProjectsPage />, { wrapper: ToastProvider });

    const button = await screen.findByRole("button", { name: /新建项目/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/项目创建失败/i)).toBeInTheDocument();
    });
  });

  it("calls signOut and redirects on 401 from fetchViewer", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/viewer")) {
        return Promise.resolve({
          ok: false, status: 401,
          json: async () => ({ error: { code: "unauthorized", message: "Bad token" } }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(<ProjectsPage />, { wrapper: ToastProvider });
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("shows error banner with retry on 500 from fetchViewer — does NOT redirect", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/viewer")) {
        return Promise.resolve({
          ok: false, status: 500,
          json: async () => ({ error: { code: "bootstrap_failed", message: "Server error" } }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(<ProjectsPage />, { wrapper: ToastProvider });
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("calls signOut and redirects on 401 from fetchProjects", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/viewer")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => viewerResponse });
      }
      if (url.includes("/api/projects")) {
        return Promise.resolve({
          ok: false, status: 401,
          json: async () => ({ error: { code: "unauthorized", message: "Bad token" } }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(<ProjectsPage />, { wrapper: ToastProvider });
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });
});