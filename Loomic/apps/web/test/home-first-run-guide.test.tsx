// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HomeFirstRunGuide } from "../src/components/home-first-run-guide";

describe("HomeFirstRunGuide", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, String(value)),
      },
    });
  });
  afterEach(cleanup);

  it("exposes the current step and persists dismissal without blocking the home page", async () => {
    render(<HomeFirstRunGuide />);
    expect(screen.getByText("三步建立你的创作工作台")).toBeInTheDocument();
    expect(screen.getByTestId("first-run-step-0")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent("第 1 步，共 3 步");

    await userEvent.click(screen.getByRole("button", { name: "关闭引导" }));
    expect(screen.queryByText("三步建立你的创作工作台")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("helstera:first-run-guide:v1")).toBe("completed");
  });
});
