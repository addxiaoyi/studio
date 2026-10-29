// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const signOut = vi.fn();
vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@test.com" },
    session: { access_token: "token-123" },
    loading: false,
    signOut,
  }),
}));

import type { ProjectSummary } from "@helstera/shared";

import { ProjectList, projectSourceLabel } from "../src/components/project-list";
import { ToastProvider } from "../src/components/toast";

/** Local midnight → ISO, so `formatDate` prints the same day in any timezone. */
function localDateIso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 0, 0, 0, 0).toISOString();
}

function project(overrides: Partial<ProjectSummary> & { id: string; name: string }): ProjectSummary {
  return {
    slug: overrides.id,
    description: null,
    workspace: {
      id: "w1",
      name: "My Workspace",
      type: "personal",
      ownerUserId: "u1",
    },
    primaryCanvas: { id: `canvas-${overrides.id}`, name: "Main Canvas", isPrimary: true },
    createdAt: localDateIso(2026, 9, 29),
    updatedAt: localDateIso(2026, 9, 29),
    ...overrides,
  } as ProjectSummary;
}

function renderList(projects: ProjectSummary[]) {
  return render(
    <ToastProvider>
      <ProjectList projects={projects} onCreateClick={() => {}} />
    </ToastProvider>,
  );
}

describe("project list source and creation time", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("labels a home-created project and shows when it was created", async () => {
    const homeProject = project({
      id: "p-home",
      name: "首页任务",
      source: "home",
      createdAt: localDateIso(2026, 9, 28),
      updatedAt: localDateIso(2026, 9, 29),
    });
    renderList([homeProject]);

    const card = await screen.findByRole("article");
    expect(within(card).getByText("首页创建")).toBeInTheDocument();
    expect(within(card).getByText(/^创建\s*2026-10-28$/)).toBeInTheDocument();
    // Updated time stays visible next to the creation time.
    expect(within(card).getByText(/^更新\s*2026-10-29$/)).toBeInTheDocument();
    // A raw enum value must never reach the card.
    expect(within(card).queryByText("home")).not.toBeInTheDocument();
  });

  it("distinguishes manual and imported projects from home-created ones", async () => {
    renderList([
      project({ id: "p-home", name: "首页任务", source: "home" }),
      project({ id: "p-manual", name: "手动项目", source: "manual" }),
      project({ id: "p-import", name: "抓取项目", source: "import" }),
    ]);

    expect(await screen.findByText("首页创建")).toBeInTheDocument();
    expect(screen.getByText("手动创建")).toBeInTheDocument();
    expect(screen.getByText("导入创建")).toBeInTheDocument();
    expect(screen.queryByText("home")).not.toBeInTheDocument();
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
  });

  it("falls back to the manual label when the payload has no source", async () => {
    // Older server / cached payload: `source` is absent.
    renderList([project({ id: "p-legacy", name: "老项目" })]);

    expect(await screen.findByText("手动创建")).toBeInTheDocument();
    expect(screen.queryByText("首页创建")).not.toBeInTheDocument();
  });

  it("maps every source value to read-able copy, including unknown ones", () => {
    expect(projectSourceLabel("home")).toBe("首页创建");
    expect(projectSourceLabel("manual")).toBe("手动创建");
    expect(projectSourceLabel("import")).toBe("导入创建");
    // Missing or unknown values are treated exactly like the column default.
    expect(projectSourceLabel(undefined)).toBe("手动创建");
    expect(projectSourceLabel(null)).toBe("手动创建");
    expect(projectSourceLabel("legacy" as never)).toBe("手动创建");
  });
});
