import "@testing-library/jest-dom/vitest";
import { CreditUsageHistory } from "@/components/credits/credit-usage-history";
import { useCredits } from "@/hooks/use-credits";
import type { CreditBalance } from "@/lib/credits-api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: null as { access_token: string; user: { id: string } } | null,
}));
const api = vi.hoisted(() => ({ balance: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/lib/credits-api", () => ({
  fetchCredits: api.balance,
  fetchCreditTransactions: api.history,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function signIn(id: string, token = `${id}-token`) {
  auth.session = { access_token: token, user: { id } };
}
function balance(amount: number): CreditBalance {
  return { balance: amount, totalToppedUp: amount + 5, totalSpent: 5 };
}
function transactions(amount: number) {
  return {
    transactions: [
      {
        id: String(amount),
        transaction_type: "generation_deduct",
        amount,
        balance_after: 0,
        description: "generation",
        created_at: Date.now(),
      },
    ],
  };
}

beforeEach(() => {
  signIn("a");
  api.balance.mockReset();
  api.history.mockReset();
});
afterEach(cleanup);

it("hides the previous balance immediately and ignores its late response after account switching", async () => {
  const a = deferred<CreditBalance>();
  const b = deferred<CreditBalance>();
  api.balance.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { result, rerender } = renderHook(() => useCredits());
  signIn("b");
  rerender();
  expect(api.balance).toHaveBeenNthCalledWith(2, "b-token");
  await act(async () => {
    b.resolve(balance(222));
  });
  expect(result.current.balance).toBe(222);
  await act(async () => {
    a.resolve(balance(111));
  });
  expect(result.current.balance).toBe(222);
  expect(result.current.totalToppedUp).toBe(227);
});

it("discards previous-account errors and does not keep credits after signing out", async () => {
  const a = deferred<CreditBalance>();
  api.balance
    .mockReturnValueOnce(a.promise)
    .mockResolvedValueOnce(balance(222));
  const { result, rerender } = renderHook(() => useCredits());
  signIn("b");
  rerender();
  await waitFor(() => expect(result.current.balance).toBe(222));
  await act(async () => {
    a.reject(new Error("old-account-private-error"));
  });
  expect(result.current.error).toBeNull();
  auth.session = null;
  rerender();
  expect(result.current.balance).toBe(0);
  expect(result.current.totalSpent).toBe(0);
  expect(result.current.loading).toBe(false);
});

it("keeps the newest overlapping balance refresh and waits for that request", async () => {
  const first = deferred<CreditBalance>();
  const latest = deferred<CreditBalance>();
  api.balance
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(latest.promise);
  const { result } = renderHook(() => useCredits());
  let refreshing: Promise<void>;
  act(() => {
    refreshing = result.current.refresh();
  });
  await act(async () => {
    first.resolve(balance(111));
  });
  expect(result.current.loading).toBe(true);
  await act(async () => {
    latest.resolve(balance(222));
    await refreshing;
  });
  expect(result.current.balance).toBe(222);
  expect(result.current.loading).toBe(false);
});

it("reloads history for the new account and excludes a late previous-account statement", async () => {
  const a = deferred<ReturnType<typeof transactions>>();
  api.history
    .mockReturnValueOnce(a.promise)
    .mockResolvedValueOnce(transactions(-222));
  const view = render(<CreditUsageHistory />);
  signIn("b");
  view.rerender(<CreditUsageHistory />);
  expect(await screen.findByText("-222")).toBeInTheDocument();
  expect(api.history).toHaveBeenCalledWith("b-token", 100, 0);
  await act(async () => {
    a.resolve(transactions(-111));
  });
  expect(screen.queryByText("-111")).not.toBeInTheDocument();
  expect(screen.getByText("-222")).toBeInTheDocument();
});

it("loads history when a session arrives after mount and clears it at sign-out", async () => {
  auth.session = null;
  api.history.mockResolvedValue(transactions(-345));
  const view = render(<CreditUsageHistory />);
  expect(api.history).not.toHaveBeenCalled();
  signIn("a");
  view.rerender(<CreditUsageHistory />);
  expect(await screen.findByText("-345")).toBeInTheDocument();
  auth.session = null;
  view.rerender(<CreditUsageHistory />);
  expect(screen.queryByText("-345")).not.toBeInTheDocument();
  expect(screen.getByText("No transactions found.")).toBeInTheDocument();
});

it("retains a loaded page and retries the same offset after loading more fails", async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({
    ...transactions(-index - 1).transactions[0],
    id: String(index),
  }));
  api.history
    .mockResolvedValueOnce({
      transactions: page,
      pagination: { limit: 100, offset: 0, hasMore: true },
    })
    .mockRejectedValueOnce(new Error("history page unavailable"))
    .mockResolvedValueOnce({
      transactions: transactions(-999).transactions,
      pagination: { limit: 100, offset: 100, hasMore: false },
    });
  render(<CreditUsageHistory />);
  await screen.findByText("-1");
  fireEvent.click(screen.getByRole("button", { name: "Load More" }));
  await screen.findByRole("alert");
  expect(screen.getByText("-1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新加载用量记录" }));
  await screen.findByText("-999");
  expect(screen.getByText("-1")).toBeInTheDocument();
  expect(api.history.mock.calls[2]).toEqual(api.history.mock.calls[1]);
  expect(api.history.mock.calls[2]).toEqual(["a-token", 100, 100]);
});

it("loads older matching transactions even when the current page has no matches", async () => {
  const older = deferred<{
    transactions: ReturnType<typeof transactions>["transactions"];
    pagination: { limit: number; offset: number; hasMore: boolean };
  }>();
  api.history
    .mockResolvedValueOnce({
      ...transactions(10),
      pagination: { limit: 100, offset: 0, hasMore: true },
    })
    .mockReturnValueOnce(older.promise);
  render(<CreditUsageHistory />);
  await screen.findByText("+10");
  fireEvent.click(screen.getByRole("button", { name: "Deducted" }));
  const more = screen.getByRole("button", { name: "Load More" });
  fireEvent.click(more);
  fireEvent.click(more);
  expect(api.history).toHaveBeenCalledTimes(2);
  await act(async () => {
    older.resolve({
      ...transactions(-20),
      pagination: { limit: 100, offset: 100, hasMore: false },
    });
  });
  expect(screen.getByText("-20")).toBeInTheDocument();
  expect(screen.queryByText("+10")).not.toBeInTheDocument();
});

it("isolates balances and statements when cookie accounts share the local-session token", async () => {
  signIn("a", "local-session");
  const oldBalance = deferred<CreditBalance>();
  const oldHistory = deferred<ReturnType<typeof transactions>>();
  api.balance
    .mockReturnValueOnce(oldBalance.promise)
    .mockResolvedValueOnce(balance(222));
  api.history
    .mockReturnValueOnce(oldHistory.promise)
    .mockResolvedValueOnce(transactions(-222));
  const credits = renderHook(() => useCredits());
  const history = render(<CreditUsageHistory />);
  signIn("b", "local-session");
  credits.rerender();
  history.rerender(<CreditUsageHistory />);
  expect(await screen.findByText("-222")).toBeInTheDocument();
  await waitFor(() => expect(credits.result.current.balance).toBe(222));
  await act(async () => {
    oldBalance.resolve(balance(111));
    oldHistory.resolve(transactions(-111));
  });
  expect(credits.result.current.balance).toBe(222);
  expect(screen.queryByText("-111")).not.toBeInTheDocument();
});
