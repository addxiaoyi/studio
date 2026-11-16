// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { JobSettlementReview } from "@/components/job-settlement-review";
import { decideJobSettlement } from "@/lib/server-api";
import type { SettlementReview } from "@helstera/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/server-api", () => ({ decideJobSettlement: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => "zh-CN" }));
const review: SettlementReview = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "pending",
  actualCost: 3.6,
  reservedCredits: 3,
  additionalCredits: 0.6,
  description: "Usage",
  createdAt: "2026-11-14T00:00:00.000Z",
  basis: {
    unit: "per_second",
    model: "test",
    seconds: 12,
    creditsPerSecond: 0.3,
  },
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("waits for the user's decision and sends the exact review identifier", async () => {
  const updated = vi.fn();
  vi.mocked(decideJobSettlement).mockResolvedValue({ job: {} as never });
  render(
    <JobSettlementReview
      userId="owner"
      token="test"
      jobId="job-1"
      review={review}
      onUpdated={updated}
    />,
  );
  expect(decideJobSettlement).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认补扣 0.6 积分" }));
  await waitFor(() => expect(updated).toHaveBeenCalledOnce());
  expect(decideJobSettlement).toHaveBeenCalledWith(
    "test",
    "job-1",
    review.id,
    "approve",
  );
});

it("allows rejection and exposes a retryable failure without claiming settlement", async () => {
  vi.mocked(decideJobSettlement).mockRejectedValue(
    new Error("连接中断，请重新查询"),
  );
  const updated = vi.fn();
  render(
    <JobSettlementReview
      userId="owner"
      token="test"
      jobId="job-1"
      review={review}
      onUpdated={updated}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "拒绝补扣" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("连接中断");
  expect(updated).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "确认补扣 0.6 积分" }),
  ).toBeEnabled();
  expect(decideJobSettlement).toHaveBeenCalledWith(
    "test",
    "job-1",
    review.id,
    "reject",
  );
});

it.each([
  {
    label: "account with the same token",
    userId: "other",
    jobId: "job-1",
    review,
  },
  { label: "job", userId: "owner", jobId: "job-2", review },
  {
    label: "review",
    userId: "owner",
    jobId: "job-1",
    review: { ...review, id: "22222222-2222-4222-8222-222222222222" },
  },
])("ignores the previous decision after changing $label", async (next) => {
  let finish: (value: Awaited<ReturnType<typeof decideJobSettlement>>) => void =
    () => {
      throw new Error("Decision not started");
    };
  vi.mocked(decideJobSettlement).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const oldUpdated = vi.fn();
  const nextUpdated = vi.fn();
  const view = render(
    <JobSettlementReview
      userId="owner"
      token="test"
      jobId="job-1"
      review={review}
      onUpdated={oldUpdated}
    />,
  );
  const confirm = screen.getByRole("button", { name: /0\.6/ });
  fireEvent.click(confirm);
  expect(confirm).toBeDisabled();
  view.rerender(
    <JobSettlementReview
      userId={next.userId}
      token="test"
      jobId={next.jobId}
      review={next.review}
      onUpdated={nextUpdated}
    />,
  );
  expect(screen.getByRole("button", { name: /0\.6/ })).toBeEnabled();
  await act(async () => {
    finish({ job: {} as never });
  });
  expect(oldUpdated).not.toHaveBeenCalled();
  expect(nextUpdated).not.toHaveBeenCalled();
});

it("does not show an old account's rejection in a new account", async () => {
  let reject: (cause: Error) => void = () => {
    throw new Error("Decision not started");
  };
  vi.mocked(decideJobSettlement).mockReturnValue(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  const updated = vi.fn();
  const view = render(
    <JobSettlementReview
      userId="owner"
      token="test"
      jobId="job-1"
      review={review}
      onUpdated={updated}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /0\.6/ }));
  view.rerender(
    <JobSettlementReview
      userId="other"
      token="test"
      jobId="job-1"
      review={review}
      onUpdated={updated}
    />,
  );
  await act(async () => {
    reject(new Error("Old account payment failure"));
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("sends at most one decision for two clicks before React commits state", async () => {
  vi.mocked(decideJobSettlement).mockReturnValue(new Promise(() => {}));
  render(
    <JobSettlementReview
      userId="owner"
      token="test"
      jobId="job-1"
      review={review}
      onUpdated={vi.fn()}
    />,
  );
  const button = screen.getByRole("button", { name: /0\.6/ });
  act(() => {
    button.click();
    button.click();
  });
  expect(decideJobSettlement).toHaveBeenCalledTimes(1);
});
