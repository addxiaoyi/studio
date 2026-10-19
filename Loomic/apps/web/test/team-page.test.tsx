// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchTeamMembersMock } = vi.hoisted(() => ({
  fetchTeamMembersMock: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));

vi.mock("../src/lib/server-api", () => ({
  fetchTeamMembers: fetchTeamMembersMock,
}));

import TeamPage from "../src/app/(workspace)/team/page";

describe("TeamPage", () => {
  afterEach(() => {
    cleanup();
    fetchTeamMembersMock.mockReset();
  });

  it("offers retry when member loading fails", async () => {
    fetchTeamMembersMock
      .mockRejectedValueOnce(new Error("members unavailable"))
      .mockResolvedValueOnce({ members: [] });
    render(<TeamPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("members unavailable");
    await userEvent.click(screen.getByRole("button", { name: "重新加载成员" }));
    await waitFor(() => expect(fetchTeamMembersMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("暂无匹配成员")).toBeInTheDocument();
  });
});
