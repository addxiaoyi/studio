// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ user: { email: "user@example.com" } }) }));
vi.mock("../src/hooks/use-credits", () => ({ useCredits: () => ({ balance: 100, totalToppedUp: 200, totalSpent: 50, loading: false, error: null, refresh: vi.fn() }) }));

import { CreditHeaderButton } from "../src/components/credits/credit-header-button";

describe("CreditHeaderButton", () => {
  beforeEach(() => document.body.innerHTML = "");
  afterEach(cleanup);

  it("moves focus into the balance dialog and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(<CreditHeaderButton />);
    const trigger = screen.getByRole("button", { name: "积分余额 100" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "积分余额与充值" })).toHaveAttribute("aria-labelledby", "credit-header-popover-title");
    expect(screen.getByRole("link", { name: /充值积分/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "积分余额与充值" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
