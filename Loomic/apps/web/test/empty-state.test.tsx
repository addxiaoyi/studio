// @ui-system — EmptyState component tests
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { FileText } from "lucide-react";
import { EmptyState, EmptyStateAction } from "../src/components/empty-state.js";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(
      <EmptyState
        icon={FileText}
        title="暂无内容"
        description="开始创建你的第一个项目"
      />,
    );
    expect(screen.getByText("暂无内容")).toBeTruthy();
    expect(screen.getByText("开始创建你的第一个项目")).toBeTruthy();
  });

  it("renders the action slot when provided", () => {
    render(
      <EmptyState
        icon={FileText}
        title="空状态"
        action={<button type="button">点击</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "点击" })).toBeTruthy();
  });

  it("icon is decorative (aria-hidden)", () => {
    const { container } = render(
      <EmptyState icon={FileText} title="标题" />,
    );
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon).toBeTruthy();
  });
});

describe("EmptyStateAction", () => {
  it("renders primary action", () => {
    render(<EmptyStateAction primary={{ label: "Create" }} />);
    const btn = screen.getByRole("button", { name: "Create" });
    expect(btn).toBeTruthy();
    expect(btn.className).toMatch(/rounded-full/);
  });

  it("calls onClick when primary is clicked", () => {
    const handler = vi.fn();
    render(
      <EmptyStateAction primary={{ label: "Submit", onClick: handler }} />,
    );
    screen.getByRole("button", { name: "Submit" }).click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("renders both primary and secondary when both provided", () => {
    render(
      <EmptyStateAction
        primary={{ label: "Primary" }}
        secondary={{ label: "Secondary" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Secondary" })).toBeTruthy();
  });
});
