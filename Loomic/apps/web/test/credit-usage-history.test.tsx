// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchTransactionsMock } = vi.hoisted(() => ({
  fetchTransactionsMock: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));

vi.mock("../src/lib/credits-api", () => ({
  fetchCreditTransactions: fetchTransactionsMock,
}));

import { CreditUsageHistory } from "../src/components/credits/credit-usage-history";

describe("CreditUsageHistory", () => {
  afterEach(() => {
    cleanup();
    fetchTransactionsMock.mockReset();
  });

  it("exposes a retryable error instead of presenting a failed request as empty history", async () => {
    fetchTransactionsMock.mockRejectedValueOnce(new Error("history unavailable"));
    render(<CreditUsageHistory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("history unavailable");
    const retry = screen.getByRole("button", { name: "重新加载用量记录" });
    fetchTransactionsMock.mockResolvedValueOnce({ transactions: [] });
    await userEvent.click(retry);

    await waitFor(() => expect(fetchTransactionsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("No transactions found.")).toBeInTheDocument();
  });
});
