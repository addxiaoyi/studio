// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { ProjectContext } from "@helstera/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFeedPackages, fetchJobs, fetchProjectContext } = vi.hoisted(() => ({
  fetchFeedPackages: vi.fn(),
  fetchJobs: vi.fn(),
  fetchProjectContext: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  fetchFeedPackages,
  fetchJobs,
}));
vi.mock("../src/lib/project-context-api", () => ({ fetchProjectContext }));
vi.mock("../src/lib/i18n", () => ({ useLocale: () => "en-US" }));

import { HomeWorkspacePulse } from "../src/components/home-workspace-pulse";

const project: ProjectContext = {
  project: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Autumn campaign",
    workspaceId: "22222222-2222-4222-8222-222222222222",
  },
  canvas: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Storyboard",
  },
  session: {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Launch planning",
  },
  view: "video",
  compositionId: "LaunchCut",
  revision: 7,
  updatedAt: "2026-11-10T10:00:00.000Z",
};

beforeEach(() => {
  fetchFeedPackages.mockResolvedValue([]);
  fetchJobs.mockResolvedValue({ jobs: [] });
  fetchProjectContext.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("project resume", () => {
  it("opens the latest project in its saved view with all identities intact", async () => {
    fetchProjectContext.mockResolvedValue(project);

    render(
      <HomeWorkspacePulse
        accessToken="token"
        projects={[]}
        projectsLoading={false}
      />,
    );

    const resumeLink = await screen.findByRole("link", {
      name: /Autumn campaign/,
    });
    const location = new URL(
      resumeLink.getAttribute("href") ?? "",
      "https://test.invalid",
    );

    expect(location.pathname).toBe("/video");
    expect(location.searchParams.get("projectId")).toBe(project.project.id);
    expect(location.searchParams.get("canvasId")).toBe(project.canvas.id);
    expect(location.searchParams.get("session")).toBe(project.session?.id);
    expect(location.searchParams.get("composition")).toBe(
      project.compositionId,
    );
    expect(new URLSearchParams(location.hash.slice(1)).get("canvasId")).toBe(
      project.canvas.id,
    );
    expect(fetchProjectContext).toHaveBeenCalledWith("token", {}, expect.any(AbortSignal));
  });

  it("shows an explicit empty state when the account has no saved project", async () => {
    fetchProjectContext.mockResolvedValue(null);

    render(
      <HomeWorkspacePulse accessToken="token" projects={[]} projectsLoading={false} />,
    );

    expect(await screen.findByText(/还没有可恢复的工程/)).toBeInTheDocument();
  });

  it("offers retry when the recent project request fails", async () => {
    fetchProjectContext
      .mockRejectedValueOnce(new Error("连接超时"))
      .mockResolvedValueOnce(project);

    render(
      <HomeWorkspacePulse accessToken="token" projects={[]} projectsLoading={false} />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("连接超时");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("link", { name: /Autumn campaign/ })).toBeInTheDocument();
    expect(fetchProjectContext).toHaveBeenCalledTimes(2);
  });

  it("ignores a late response from the previous account", async () => {
    let resolveFirst: ((value: ProjectContext) => void) | undefined;
    const previousProject = {
      ...project,
      project: { ...project.project, name: "Previous account project" },
    };
    const currentProject = {
      ...project,
      project: {
        ...project.project,
        id: "55555555-5555-4555-8555-555555555555",
        name: "Current account project",
      },
    };
    fetchProjectContext
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(currentProject);

    const props = { projects: [], projectsLoading: false };
    const view = render(<HomeWorkspacePulse accessToken="first-token" {...props} />);
    view.rerender(<HomeWorkspacePulse accessToken="second-token" {...props} />);

    expect(await screen.findByRole("link", { name: /Current account project/ })).toBeInTheDocument();
    await act(async () => resolveFirst?.(previousProject));
    expect(screen.queryByText("Previous account project")).not.toBeInTheDocument();
  });
});
