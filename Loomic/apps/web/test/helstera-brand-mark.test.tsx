// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HelsteraBrandMark } from "../src/components/helstera-brand-mark";

describe("HelsteraBrandMark", () => {
  afterEach(cleanup);

  it("renders the compact icon-only brand mark", () => {
    render(<HelsteraBrandMark size="sm" showIcon={false} />);
    expect(screen.getByRole("img", { name: "Helstera" })).toBeInTheDocument();
    expect(document.querySelector(".stroke-text")).not.toBeInTheDocument();
  });

  it("renders the animated wordmark with an accessible brand label", () => {
    render(<HelsteraBrandMark size="lg" animated />);
    expect(screen.getByRole("img", { name: "Helstera" })).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
  });
});
