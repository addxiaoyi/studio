import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import VideoPage from "@/app/(workspace)/video/page";

vi.mock("@/components/visualforge-workspace", () => ({ VisualForgeWorkspace: () => <section aria-label="统一视频工程" /> }));
vi.mock("@/components/video-editor", () => ({ VideoEditor: () => <section aria-label="独立剪辑页" /> }));
vi.mock("@/components/creation-workspace", () => ({ CreationWorkspace: () => <section aria-label="独立生成页" /> }));
afterEach(cleanup);

it("opens a single project without separate editing and generation pages", () => {
  render(<VideoPage />);
  expect(screen.getByRole("region", { name: "统一视频工程" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^视频剪辑$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^视频生成$/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("独立剪辑页")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("独立生成页")).not.toBeInTheDocument();
});
