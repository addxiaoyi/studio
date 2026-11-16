// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

import { WorkspaceBreadcrumbs } from "../src/components/workspace-breadcrumbs";

describe("WorkspaceBreadcrumbs", () => {
  it("waits for a pathname without crashing or inventing a parent route", () => {
    mockUsePathname.mockReturnValue(null);
    const view = render(<WorkspaceBreadcrumbs />);
    expect(
      screen.queryByRole("navigation", { name: "页面路径" }),
    ).not.toBeInTheDocument();
    mockUsePathname.mockReturnValue("/projects/archived");
    view.rerender(<WorkspaceBreadcrumbs />);
    expect(screen.getByText("回收站")).toHaveAttribute("aria-current", "page");
  });

  it("renders a malformed encoded route segment without losing workspace navigation", () => {
    mockUsePathname.mockReturnValue("/projects/%E0%A4%A");
    render(<WorkspaceBreadcrumbs />);
    expect(screen.getByText("%E0%A4%A")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "返回项目" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });
  afterEach(() => {
    cleanup();
    mockUsePathname.mockReset();
  });

  it("provides a parent path and marks the current nested route", () => {
    mockUsePathname.mockReturnValue("/projects/archived");

    render(<WorkspaceBreadcrumbs />);

    expect(
      screen.getByRole("navigation", { name: "页面路径" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回项目" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(screen.getByText("回收站")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
      "href",
      "/home",
    );
  });

  it("does not add chrome to a top-level workspace route", () => {
    mockUsePathname.mockReturnValue("/home");

    render(<WorkspaceBreadcrumbs />);

    expect(
      screen.queryByRole("navigation", { name: "页面路径" }),
    ).not.toBeInTheDocument();
  });
});
