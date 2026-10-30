import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

function Broken(): never {
  throw new Error("secret technical failure");
}

describe("ErrorBoundary recovery", () => {
  it("exposes retry, workbench navigation, and collapsed technical details", () => {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "重试当前区域" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回工作台" })).toBeTruthy();
    expect(screen.getByText("技术详情")).toBeTruthy();
    expect(screen.getByText("secret technical failure").closest("details")?.open).toBe(false);
  });
});
