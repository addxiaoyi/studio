// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("../src/hooks/use-create-project", () => ({
  useCreateProject: () => ({ create: createMock, creating: false }),
}));

import CreatePage from "../src/app/(workspace)/create/page";

describe("CreatePage draft recovery", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    createMock.mockReset();
  });

  it("restores the brief and project type from the current tab session", async () => {
    sessionStorage.setItem("helstera:create-workspace-draft:v1", JSON.stringify({
      type: "film",
      brief: "A short story about a night train.",
    }));

    render(<CreatePage />);

    expect(await screen.findByLabelText("故事梗概（可选）")).toHaveValue("A short story about a night train.");
    expect(screen.getByRole("button", { name: /AI 短片/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("草稿已暂存到当前标签页"));
  });
});
