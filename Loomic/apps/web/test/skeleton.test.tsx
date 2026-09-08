// @ui-system — Skeleton component smoke tests
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { Skeleton, SkeletonText, SkeletonCard } from "../src/components/skeleton.js";

describe("Skeleton", () => {
  it("renders a placeholder div", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.tagName).toBe("DIV");
  });

  it("applies the correct border-radius class", () => {
    const { container } = render(<Skeleton rounded="full" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/rounded-full/);
  });
});

describe("SkeletonText", () => {
  it("renders the requested number of lines", () => {
    const { container } = render(<SkeletonText lines={4} />);
    const lines = container.querySelectorAll('[aria-hidden="true"]');
    expect(lines.length).toBe(4);
  });

  it("uses default of 1 line when not specified", () => {
    const { container } = render(<SkeletonText />);
    const lines = container.querySelectorAll('[aria-hidden="true"]');
    expect(lines.length).toBe(1);
  });
});

describe("SkeletonCard", () => {
  it("renders an image placeholder when showImage is true", () => {
    const { container } = render(<SkeletonCard showImage />);
    expect(container.querySelector(".aspect-\\[4\\/3\\]")).toBeTruthy();
  });

  it("omits the image placeholder when showImage is false", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelector(".aspect-\\[4\\/3\\]")).toBeFalsy();
  });
});
