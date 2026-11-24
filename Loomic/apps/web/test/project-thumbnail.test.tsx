// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectThumbnail } from "../src/components/project-thumbnail";

afterEach(cleanup);

describe("ProjectThumbnail", () => {
  it("requests a fresh preview when the project's revision changes", () => {
    const { rerender } = render(<ProjectThumbnail alt="Canvas" src="/api/projects/project-1/thumbnail" revision="first" />);
    const before = screen.getByRole("img", { name: "Canvas" }).getAttribute("src");
    fireEvent.error(screen.getByRole("img", { name: "Canvas" }));
    rerender(<ProjectThumbnail alt="Canvas" src="/api/projects/project-1/thumbnail" revision="second" />);
    const after = screen.getByRole("img", { name: "Canvas" }).getAttribute("src");
    expect(after).not.toBe(before);
    expect(after).toContain("v=second");
  });

  it("shows an explicit empty state when a project has no preview", () => {
    render(<ProjectThumbnail alt="Brand System preview" src={null} />);

    expect(screen.getByRole("img", { name: /暂无预览/ })).toBeInTheDocument();
    expect(screen.getByText("打开画布后会自动生成预览")).toBeInTheDocument();
  });

  it("recovers to a visible fallback when the thumbnail cannot be loaded", () => {
    render(<ProjectThumbnail alt="Brand System preview" src="/thumbnail.webp" />);

    fireEvent.error(screen.getByRole("img", { name: "Brand System preview" }));

    expect(screen.getByRole("img", { name: /预览暂不可用/ })).toBeInTheDocument();
  });
});
