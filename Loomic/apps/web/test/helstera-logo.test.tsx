// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

describe("HelsteraLogo", () => {
  it("renders a theme-aware vector mark instead of the raster wordmark", () => {
    const { container } = render(<HelsteraLogo className="size-6" />);
    const logo = screen.getByRole("img", { name: "Helstera" });
    expect(logo.tagName.toLowerCase()).toBe("svg");
    expect(logo.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(container.querySelector("img")).toBeNull();
  });
});
