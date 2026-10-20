// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectThumbnail } from "../src/components/project-thumbnail";

describe("ProjectThumbnail layout", () => {
  it("fits the full canvas thumbnail without cropping its edges", () => {
    render(<ProjectThumbnail alt="Canvas preview" src="/thumbnail.webp" />);

    expect(screen.getByRole("img", { name: "Canvas preview" })).toHaveClass("object-contain");
  });
});
