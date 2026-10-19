// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

describe("HelsteraLogo", () => {
  it("renders the shared text wordmark", () => {
    const { container } = render(<HelsteraLogo className="size-6" />);
    const logo = screen.getByRole("img", { name: "Helstera" });
    expect(logo.tagName.toLowerCase()).toBe("span");
    expect(logo.textContent).toBe("Helstera");
    expect(logo.className).toContain("helstera-wordmark");
    expect(container.querySelector("img")).toBeNull();
  });
});
