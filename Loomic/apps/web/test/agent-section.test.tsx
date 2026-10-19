// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchImageModelsMock, fetchVideoModelsMock } = vi.hoisted(() => ({
  fetchImageModelsMock: vi.fn(),
  fetchVideoModelsMock: vi.fn(),
}));

vi.mock("../src/lib/i18n", () => ({
  useLocale: () => "zh-CN",
  t: () => ({
    agent: {
      title: "智能体与默认模型",
      description: "设置对话和媒体生成偏好。",
      defaultModel: "默认对话模型",
      loading: "正在加载模型",
      loadFailed: "模型加载失败",
      empty: "暂无可用模型",
      mediaHint: "请配置模型后重试。",
      configure: "前往配置",
      allSessions: "应用于所有会话",
      updated: "已更新",
      updateFailed: "更新失败",
      saving: "保存中…",
      save: "保存",
    },
  }),
}));
vi.mock("../src/hooks/use-image-model-preference", () => ({
  useImageModelPreference: () => ({ preference: { mode: "auto", models: [] }, setPreference: vi.fn() }),
}));
vi.mock("../src/hooks/use-video-model-preference", () => ({
  useVideoModelPreference: () => ({ preference: { mode: "auto", models: [], duration: 5 }, setPreference: vi.fn(), setDuration: vi.fn() }),
}));
vi.mock("../src/lib/server-api", () => ({
  fetchImageModels: fetchImageModelsMock,
  fetchVideoModels: fetchVideoModelsMock,
}));
vi.mock("../src/components/ui/styled-select", () => ({
  StyledSelect: ({ value, onChange, options, ariaLabel, ["aria-label"]: ariaLabelProp, disabled }: any) => (
    <select aria-label={ariaLabel ?? ariaLabelProp} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

import { AgentSection } from "../src/components/agent-section";

const imageResponse = { models: [{ id: "image-1", displayName: "图片模型", provider: "test", billingUnit: "per_generation", providerPriceCny: 1 }] };
const videoResponse = { models: [{ id: "video-1", displayName: "视频模型", provider: "test", billingUnit: "per_second", providerPriceCny: 1, limits: { maxResolution: "720p" } }] };

describe("AgentSection", () => {
  beforeEach(() => {
    fetchImageModelsMock.mockReset().mockResolvedValue(imageResponse);
    fetchVideoModelsMock.mockReset().mockResolvedValue(videoResponse);
  });

  afterEach(cleanup);

  it("keeps conversation, image, and video model controls distinct", async () => {
    render(<AgentSection defaultModel="chat-1" onSave={vi.fn()} fetchModels={vi.fn().mockResolvedValue({ models: [{ id: "chat-1", name: "对话模型", provider: "test" }] })} autoApprovePaidGeneration={false} onAutoApproveChange={vi.fn()} autoDeleteEmptyCanvas={false} onAutoDeleteEmptyCanvasChange={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: "默认对话模型" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "默认图片模型" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "默认视频模型" })).toBeInTheDocument();
  });

  it("offers retry when media model loading fails", async () => {
    fetchImageModelsMock.mockRejectedValueOnce(new Error("image catalog unavailable"));
    fetchVideoModelsMock.mockRejectedValueOnce(new Error("video catalog unavailable"));
    render(<AgentSection defaultModel="chat-1" onSave={vi.fn()} fetchModels={vi.fn().mockResolvedValue({ models: [{ id: "chat-1", name: "对话模型", provider: "test" }] })} autoApprovePaidGeneration={false} onAutoApproveChange={vi.fn()} autoDeleteEmptyCanvas={false} onAutoDeleteEmptyCanvasChange={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("图片和视频模型加载失败");
    fetchImageModelsMock.mockResolvedValueOnce(imageResponse);
    fetchVideoModelsMock.mockResolvedValueOnce(videoResponse);
    await userEvent.click(screen.getByRole("button", { name: "重试加载媒体模型" }));
    expect(await screen.findByRole("combobox", { name: "默认图片模型" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
