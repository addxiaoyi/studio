// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  image: vi.fn(), video: vi.fn(), job: vi.fn(), confirm: vi.fn(), status: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token", user: { id: "creator" } } }) }));
vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...await importOriginal<object>(),
  fetchImageModels: async () => ({ models: [{ id: "gpt-image-2", displayName: "GPT Image-2", creditCost: 0.05 }] }),
  fetchVideoModels: async () => ({ models: [{ id: "hailuo-h3", displayName: "Hailuo H3", limits: { maxDuration: 6, allowedDurations: [4, 6], maxResolution: "768p" }, resolutionRates: [{ resolution: "768p", priceCnyPerSecond: 0.432 }] }] }),
  generateImageDirect: api.image, generateVideoDirect: api.video, fetchJob: api.job,
  confirmGenerationApproval: api.confirm, fetchGenerationApprovalStatus: api.status, cancelGenerationApproval: api.cancel,
}));
vi.mock("../src/components/ui/styled-select", () => ({
  StyledSelect: ({ options, onChange, ...props }: { options: { value: string; label: string }[]; onChange: (value: string) => void }) =>
    <select {...props} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));

import { ApiApplicationError } from "../src/lib/server-api";
import { CreationWorkspace } from "../src/components/creation-workspace";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.status.mockResolvedValue({ approvalStatus: "pending" });
  api.confirm.mockResolvedValue({ data: { jobId: "job-1" } });
  api.cancel.mockResolvedValue({});
  api.job.mockResolvedValue({ job: { id: "job-1", status: "succeeded", result: { signed_url: "/image.png", mime_type: "image/png" } } });
  api.image.mockRejectedValue(new ApiApplicationError("generation_confirmation_required", "Confirmation required before credits are charged.", {
    approvalId: "approval-1", jobType: "image_generation", model: "gpt-image-2", estimatedCredits: 0.05,
    hasReferenceImage: false, expiresAt: "2030-01-01T00:00:00.000Z",
  }));
});
afterEach(cleanup);

it("shows the charge approval and recovers the confirmed image job without submitting twice", async () => {
  render(<CreationWorkspace mode="image" />);
  await screen.findByRole("option", { name: "GPT Image-2" });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "A ceramic cup" } });
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByRole("region", { name: "Generation confirmation" })).toHaveTextContent("0.05 credits");
  expect(api.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "开始生成" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认生成" }));
  expect(await screen.findByRole("img", { name: "A ceramic cup" })).toHaveAttribute("src", "/image.png");
  expect(api.image).toHaveBeenCalledTimes(1);
  expect(api.confirm).toHaveBeenCalledTimes(1);
  expect(api.job).toHaveBeenCalledWith("token", "job-1", expect.any(AbortSignal));
});

it("allows a new request after canceling the approval without charging", async () => {
  render(<CreationWorkspace mode="image" />);
  await screen.findByRole("option", { name: "GPT Image-2" });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "A ceramic cup" } });
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  fireEvent.click(await screen.findByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled());
  expect(api.confirm).not.toHaveBeenCalled();
  expect(api.job).not.toHaveBeenCalled();
});

it("uses the selected video model's supported duration and resolution", async () => {
  render(<CreationWorkspace mode="video" />);
  await screen.findByRole("option", { name: "Hailuo H3" });
  expect(screen.getByLabelText("时长")).toHaveValue("4");
  expect(screen.getByLabelText("清晰度")).toHaveValue("768p");
  expect(screen.queryByRole("option", { name: "10 秒" })).not.toBeInTheDocument();
});

it("recovers an approved job after reload without submitting a new generation", async () => {
  sessionStorage.setItem("loomic:creation:creator:image", JSON.stringify({
    approval: { approvalId: "saved-approval", jobType: "image_generation", model: "gpt-image-2", estimatedCredits: 0.05, hasReferenceImage: false, expiresAt: "2030-01-01T00:00:00.000Z" },
    prompt: "Saved cup", jobId: "job-1",
  }));
  render(<CreationWorkspace mode="image" />);
  expect(await screen.findByRole("img", { name: "Saved cup" })).toHaveAttribute("src", "/image.png");
  expect(api.image).not.toHaveBeenCalled();
  expect(api.confirm).not.toHaveBeenCalled();
});
