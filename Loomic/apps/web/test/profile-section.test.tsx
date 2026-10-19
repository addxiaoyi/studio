// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileSection } from "../src/components/profile-section";

describe("ProfileSection", () => {
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

  it("renders each social platform connection card once", () => {
    render(
      <ProfileSection
        displayName="Test User"
        email="test@example.com"
        onSave={vi.fn()}
        accounts={[]}
        accountBusy={false}
        onBindAccount={vi.fn()}
        onRevokeAccount={vi.fn()}
      />,
    );

    expect(screen.getAllByText("X")).toHaveLength(1);
  });

  it("shows account status and confirms a revoke failure without an unhandled rejection", async () => {
    const revoke = vi.fn().mockRejectedValue(new Error("账号服务不可用"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ProfileSection
        displayName="Test User"
        email="test@example.com"
        onSave={vi.fn()}
        accounts={[{ id: "account-1", platform: "douyin", alias: "品牌主账号", notes: "", status: "pending", connection_mode: "scan_confirm" }]}
        accountBusy={false}
        onBindAccount={vi.fn()}
        onRevokeAccount={revoke}
      />,
    );

    expect(screen.getByLabelText("连接状态：待确认")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "解绑" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("账号服务不可用");
    expect(revoke).toHaveBeenCalledWith("account-1");
  });
});
