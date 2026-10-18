// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectThumbnail } from "../src/components/project-thumbnail";

describe("ProjectThumbnail", () => {
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
