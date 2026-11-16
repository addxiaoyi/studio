import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { access_token: "same-token", user: { id: "owner" } } as {
    access_token: string;
    user: { id: string };
  } | null,
  query: new URLSearchParams(),
  order: vi.fn(),
  checkout: vi.fn(),
  refresh: vi.fn(),
  assign: vi.fn(),
  copy: {
    title: "余额与充值",
    description: "按实际用量扣款。",
    custom: "自定义充值",
    customHint: "¥10–¥50,000",
    paid: "充值已到账。",
    incomplete: "充值订单未完成。",
    unknown: "订单状态暂时无法确认。",
    createFailed: "创建订单失败，请重试。",
    invalidAmount: "充值金额不合法。",
    credits: "积分",
    bestValue: "最划算",
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.query }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("@/hooks/use-credits", () => ({
  useCredits: () => ({
    balance: 100,
    totalToppedUp: 200,
    totalSpent: 100,
    refresh: state.refresh,
  }),
}));
vi.mock("@/lib/credits-api", () => ({
  createEpayTopup: state.checkout,
  createEpayCustomTopup: state.checkout,
  fetchTopupPackages: async () => ({ packages: [] }),
  getTopupOrder: state.order,
  isEpayEnabled: () => true,
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => "zh-CN",
  t: () => ({ billing: state.copy }),
}));

import { BillingSection } from "@/components/billing-section";

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized");
  };
  let reject: (reason: Error) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { access_token: "same-token", user: { id: "owner" } };
  state.query = new URLSearchParams();
  state.order.mockReset();
  state.checkout.mockReset();
  state.refresh.mockReset().mockResolvedValue(undefined);
  const browser = window;
  vi.stubGlobal(
    "window",
    new Proxy(browser, {
      get(target, property) {
        if (property === "location") return { assign: state.assign };
        return Reflect.get(target, property, target);
      },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("ignores an old account's paid order even when the session token is reused", async () => {
  const oldOrder = deferred<{ order: { status: string } }>();
  state.query = new URLSearchParams("topup=old-order");
  state.order
    .mockReturnValueOnce(oldOrder.promise)
    .mockReturnValue(new Promise(() => {}));
  const view = render(<BillingSection />);
  await waitFor(() => expect(state.order).toHaveBeenCalledOnce());
  state.session = { access_token: "same-token", user: { id: "peer" } };
  view.rerender(<BillingSection />);
  await act(async () => oldOrder.resolve({ order: { status: "paid" } }));
  expect(state.refresh).not.toHaveBeenCalled();
  expect(screen.queryAllByText(state.copy.paid)).toHaveLength(0);
});

it("does not navigate to an old account's checkout after switching accounts", async () => {
  const checkout = deferred<{ checkoutUrl: string }>();
  state.checkout.mockReturnValueOnce(checkout.promise);
  const view = render(<BillingSection />);
  fireEvent.click(screen.getByRole("button", { name: "充值" }));
  expect(state.checkout).toHaveBeenCalledWith("same-token", 10000, "alipay");
  state.session = { access_token: "same-token", user: { id: "peer" } };
  view.rerender(<BillingSection />);
  await act(async () =>
    checkout.resolve({ checkoutUrl: "https://pay.example.test/old-account" }),
  );
  expect(state.assign).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "充值" })).not.toBeDisabled();
});

it("clears the old payment form and ignores a late private checkout failure", async () => {
  const checkout = deferred<{ checkoutUrl: string }>();
  state.checkout.mockReturnValueOnce(checkout.promise);
  const view = render(<BillingSection />);
  fireEvent.change(screen.getByRole("spinbutton"), {
    target: { value: "765" },
  });
  fireEvent.click(screen.getByRole("button", { name: "充值" }));
  state.session = { access_token: "same-token", user: { id: "peer" } };
  view.rerender(<BillingSection />);
  await act(async () =>
    checkout.reject(new Error("old private payment failure")),
  );
  expect(screen.queryAllByText("old private payment failure")).toHaveLength(0);
  expect(screen.getByRole("spinbutton")).toHaveValue(100);
});

it("does not redirect after the billing page unmounts", async () => {
  const checkout = deferred<{ checkoutUrl: string }>();
  state.checkout.mockReturnValueOnce(checkout.promise);
  const view = render(<BillingSection />);
  fireEvent.click(screen.getByRole("button", { name: "充值" }));
  view.unmount();
  await act(async () =>
    checkout.resolve({ checkoutUrl: "https://pay.example.test/left-page" }),
  );
  expect(state.assign).not.toHaveBeenCalled();
});

it("still completes the current account's checkout and paid-order refresh", async () => {
  state.query = new URLSearchParams("topup=current-order");
  state.order.mockResolvedValue({ order: { status: "paid" } });
  state.checkout.mockResolvedValue({
    checkoutUrl: "https://pay.example.test/current",
  });
  render(<BillingSection />);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(state.copy.paid),
  );
  expect(state.refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "充值" }));
  await waitFor(() =>
    expect(state.assign).toHaveBeenCalledWith(
      "https://pay.example.test/current",
    ),
  );
});

it("discards a paid notice when the account changes during the balance refresh", async () => {
  const refresh = deferred<void>();
  state.query = new URLSearchParams("topup=old-order");
  state.order
    .mockResolvedValueOnce({ order: { status: "paid" } })
    .mockReturnValue(new Promise(() => {}));
  state.refresh.mockReturnValueOnce(refresh.promise);
  const view = render(<BillingSection />);
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  state.session = null;
  view.rerender(<BillingSection />);
  await act(async () => refresh.resolve());
  expect(screen.queryAllByText(state.copy.paid)).toHaveLength(0);
});
