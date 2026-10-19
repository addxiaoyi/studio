// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createCustomTopupMock, fetchPackagesMock } = vi.hoisted(() => ({
  createCustomTopupMock: vi.fn(),
  fetchPackagesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));
vi.mock("../src/hooks/use-credits", () => ({
  useCredits: () => ({ balance: 100, totalToppedUp: 200, totalSpent: 100, refresh: vi.fn() }),
}));
vi.mock("../src/lib/credits-api", () => ({
  createEpayTopup: vi.fn(),
  createEpayCustomTopup: createCustomTopupMock,
  fetchTopupPackages: fetchPackagesMock,
  getTopupOrder: vi.fn(),
  isEpayEnabled: () => true,
}));
vi.mock("../src/lib/i18n", () => ({
  useLocale: () => "zh-CN",
  t: () => ({
    billing: {
      title: "余额与充值",
      description: "按实际用量扣款。",
      custom: "自定义充值",
      customHint: "¥10–¥50,000",
      paid: "充值已到账。",
      incomplete: "充值订单未完成。",
      unknown: "订单状态暂时无法确认。",
      createFailed: "创建订单失败，请重试。",
      invalidAmount: "自定义充值金额需为 ¥10 至 ¥50,000。",
      credits: "积分",
      bestValue: "最划算",
    },
  }),
}));

import { BillingSection } from "../src/components/billing-section";

describe("BillingSection", () => {
  beforeEach(() => {
    fetchPackagesMock.mockResolvedValue({ packages: [] });
    createCustomTopupMock.mockReset();
  });

  afterEach(cleanup);

  it("shows a retryable package error instead of silently omitting it", async () => {
    fetchPackagesMock.mockRejectedValueOnce(new Error("catalog unavailable"));
    render(<BillingSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent("充值套餐暂时无法加载");
    expect(screen.getByRole("button", { name: "重试加载套餐" })).toBeInTheDocument();
  });

  it("keeps custom top-up errors visible and exposes the loading lock", async () => {
    createCustomTopupMock.mockRejectedValueOnce(new Error("支付服务不可用"));
    render(<BillingSection />);
    const amount = screen.getByRole("spinbutton", { name: "充值金额（元）" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "100");
    await userEvent.click(screen.getByRole("button", { name: "充值" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("支付服务不可用");
    expect(screen.getByRole("button", { name: "充值" })).not.toHaveAttribute("aria-busy", "true");
  });
});
