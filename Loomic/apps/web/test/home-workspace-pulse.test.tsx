// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchFeedPackagesMock, fetchJobsMock } = vi.hoisted(() => ({
  fetchFeedPackagesMock: vi.fn(),
  fetchJobsMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  fetchFeedPackages: fetchFeedPackagesMock,
  fetchJobs: fetchJobsMock,
}));

import { HomeWorkspacePulse } from "../src/components/home-workspace-pulse";

afterEach(() => {
  cleanup();
  fetchFeedPackagesMock.mockReset();
  fetchJobsMock.mockReset();
});

describe("HomeWorkspacePulse", () => {
  it("shows recent projects, feed packages, and recoverable jobs", async () => {
    fetchFeedPackagesMock.mockResolvedValue([{ id: "package-1", title: "春季商品内容", status: "failed" }]);
    fetchJobsMock.mockResolvedValue({ jobs: [{ id: "job-1", job_type: "video_generation", status: "running", progress: 42, stage: "Provider 请求" }] });

    render(
      <HomeWorkspacePulse
        accessToken="token"
        projects={[{ id: "project-1", name: "商品主视觉", primaryCanvas: { id: "canvas-1", name: "画布" } } as never]}
        projectsLoading={false}
      />,
    );

    await waitFor(() => expect(screen.getByText("春季商品内容")).toBeInTheDocument());
    expect(screen.getByText("商品主视觉")).toBeInTheDocument();
    expect(screen.getByText("Provider 请求")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /春季商品内容/ })).toHaveAttribute("href", "/feed?packageId=package-1&step=2");
  });

  it("shows a clear empty state when there is no work", async () => {
    fetchFeedPackagesMock.mockResolvedValue([]);
    fetchJobsMock.mockResolvedValue({ jobs: [] });

    render(<HomeWorkspacePulse accessToken="token" projects={[]} projectsLoading={false} />);

    await waitFor(() => expect(screen.getByText("还没有可继续的工作")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /配置品牌资产/ })).toHaveAttribute("href", "/brand-kit");
  });
});
