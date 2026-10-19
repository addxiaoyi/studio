// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchSkillsMock, fetchWorkspaceSkillsMock } = vi.hoisted(() => ({
  fetchSkillsMock: vi.fn(),
  fetchWorkspaceSkillsMock: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));

vi.mock("../src/lib/server-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/server-api")>();
  return {
    ...actual,
    fetchSkills: fetchSkillsMock,
    fetchWorkspaceSkills: fetchWorkspaceSkillsMock,
  };
});

vi.mock("../src/components/skeletons/skills-skeleton", () => ({
  SkillsSkeleton: () => <div role="status">loading</div>,
}));

import SkillsPage from "../src/app/(workspace)/skills/page";

describe("SkillsPage", () => {
  afterEach(() => {
    cleanup();
    fetchSkillsMock.mockReset();
    fetchWorkspaceSkillsMock.mockReset();
  });

  it("offers retry when the skill catalog fails to load", async () => {
    fetchSkillsMock
      .mockRejectedValueOnce(new Error("catalog unavailable"))
      .mockResolvedValueOnce({ skills: [] });
    fetchWorkspaceSkillsMock.mockResolvedValue({ skills: [] });
    render(<SkillsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("catalog unavailable");
    await userEvent.click(screen.getByRole("button", { name: "重试加载技能" }));
    expect(await screen.findByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(fetchSkillsMock).toHaveBeenCalledTimes(2);
  });
});
