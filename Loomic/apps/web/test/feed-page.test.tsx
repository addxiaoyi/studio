// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15_000 });

const {
  createFeedPackageMock,
  approveFeedStructureMock,
  fetchFeedPackageMock,
  fetchFeedRenderStatusMock,
  renderFeedPackageMock,
  saveFeedStructureDraftMock,
  createFeedScheduleMock,
  actOnFeedScheduleMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  createFeedPackageMock: vi.fn(),
  approveFeedStructureMock: vi.fn(),
  fetchFeedPackageMock: vi.fn(),
  fetchFeedRenderStatusMock: vi.fn(),
  renderFeedPackageMock: vi.fn(),
  saveFeedStructureDraftMock: vi.fn(),
  createFeedScheduleMock: vi.fn(),
  actOnFeedScheduleMock: vi.fn(),
  searchParamsMock: { current: new URLSearchParams() },
}));

const packageStructure = {
  title: "生成标题",
  hook: "前三秒先给结果",
  audience: "通勤人群",
  painPoint: "雨天收纳麻烦",
  angle: "用真实场景解释商品价值",
  hypothesis: "场景化展示更容易转化",
  evidence: ["商品尺寸来自用户提供资料"],
  cta: "点击查看详情",
  riskNotes: ["不得虚构防水等级"],
  imagePrompt: "商品首帧",
  videoPrompt: "指定时长短视频",
  shots: [
    {
      id: "shot-1",
      startSecond: 0,
      endSecond: 5,
      visual: "展示雨天通勤场景",
      voiceover: "先给问题",
      subtitle: "雨天也能轻松收纳",
    },
  ],
};

const packageRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "生成标题",
  brief: "商品和受众说明",
  trend_item_id: "22222222-2222-4222-8222-222222222222",
  status: "structured",
  platforms: ["douyin", "xiaohongshu"],
  duration_seconds: 15,
  workflow_mode: "review" as const,
  estimated_cost_cny: 1,
  structure: packageStructure,
  variants: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      package_id: "11111111-1111-4111-8111-111111111111",
      platform: "douyin",
      title: "抖音标题",
      body: "抖音正文",
      hashtags: ["通勤"],
      cover_text: "抖音封面",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      package_id: "11111111-1111-4111-8111-111111111111",
      platform: "xiaohongshu",
      title: "小红书标题",
      body: "小红书正文",
      hashtags: ["收纳"],
      cover_text: "小红书封面",
    },
  ],
};

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    session: { access_token: "test-token", user: { id: "user-1" } },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("../src/hooks/use-create-project", () => ({
  useCreateProject: () => ({ create: vi.fn(), creating: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => searchParamsMock.current,
}));

vi.mock("../src/components/ui/styled-select", () => ({
  StyledSelect: ({ value, onChange, options, ariaLabel }: any) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock("../src/lib/server-api", () => ({
  createFeedPackage: createFeedPackageMock,
  createFeedSchedule: createFeedScheduleMock,
  approveFeedStructure: approveFeedStructureMock,
  fetchPublishingAccounts: vi.fn(),
  actOnFeedSchedule: actOnFeedScheduleMock,
  downloadFeedManifest: vi.fn(),
  downloadFeedTimeline: vi.fn(),
  fetchFeedPackage: fetchFeedPackageMock,
  fetchFeedRenderStatus: fetchFeedRenderStatusMock,
  fetchFeedPackages: vi.fn(),
  fetchFeedTrends: vi.fn(),
  fetchFeedSources: vi.fn(),
  renderFeedPackage: renderFeedPackageMock,
  saveFeedStructureDraft: saveFeedStructureDraftMock,
  syncFeedTrends: vi.fn(),
  fetchVideoModels: vi.fn(),
  saveFeedMetric: vi.fn(),
}));

import FeedPage from "../src/app/(workspace)/feed/page";

beforeEach(async () => {
  searchParamsMock.current = new URLSearchParams();
  createFeedPackageMock.mockReset();
  approveFeedStructureMock.mockReset();
  fetchFeedPackageMock.mockReset();
  fetchFeedRenderStatusMock.mockReset();
  renderFeedPackageMock.mockReset();
  saveFeedStructureDraftMock.mockReset();
  createFeedScheduleMock.mockReset();
  actOnFeedScheduleMock.mockReset();

  const api = await import("../src/lib/server-api");
  vi.mocked(api.fetchFeedTrends).mockResolvedValue({
    items: [{
      id: packageRecord.trend_item_id!,
      platform: "系统中文热点",
      title: "真实热点标题",
      summary: "真实热点摘要",
      heat: 98,
      source_url: "https://example.com/trend",
    }],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    sort: "heat",
    query: "",
  });
  vi.mocked(api.fetchFeedPackages).mockResolvedValue([]);
  vi.mocked(api.fetchVideoModels).mockResolvedValue({ models: [], unavailableModels: [] });
  vi.mocked(api.fetchPublishingAccounts).mockResolvedValue([]);
  vi.mocked(api.fetchFeedSources).mockResolvedValue([]);
  vi.mocked(api.syncFeedTrends).mockResolvedValue({ sources: [], failed: 0, partial: false });

  createFeedPackageMock.mockResolvedValue(packageRecord);
  fetchFeedPackageMock.mockResolvedValue(packageRecord);
  fetchFeedRenderStatusMock.mockResolvedValue({ packageId: packageRecord.id, status: "rendering", jobs: [] });
  approveFeedStructureMock.mockImplementation(async (_token, _id, structure) => ({
    ...packageRecord,
    status: "approved",
    structure,
  }));
  renderFeedPackageMock.mockResolvedValue({ id: packageRecord.id, status: "rendering", jobs: [] });
  saveFeedStructureDraftMock.mockImplementation(async (_token, _id, structure) => ({ ...packageRecord, structure }));
  createFeedScheduleMock.mockResolvedValue({ id: "plan-default" });
  actOnFeedScheduleMock.mockResolvedValue({});
});

afterEach(cleanup);

async function openCustomTopic(user: ReturnType<typeof userEvent.setup>) {
  render(<FeedPage />);
  await waitFor(() => expect(screen.getByTestId("feed-custom-topic")).toBeInTheDocument());
  await user.click(screen.getByTestId("feed-custom-topic"));
  await user.type(screen.getByPlaceholderText("例如：通勤人群如何解决雨天收纳"), "自定义商品选题");
  await user.type(screen.getByPlaceholderText("说清商品、卖点、受众和不能虚构的参数"), "商品和受众说明");
  await user.click(screen.getByRole("button", { name: "生成内容包" }));
  await waitFor(() => expect(screen.getByTestId("feed-approve-structure")).toBeInTheDocument());
}

describe("feed workflow closure", () => {
  it("keeps custom topics independent from hotspot ids", async () => {
    const user = userEvent.setup();
    await openCustomTopic(user);

    expect(createFeedPackageMock).toHaveBeenCalledWith("test-token", expect.objectContaining({
      trendItemId: null,
    }));
  });

  it("passes the selected real hotspot id into the package", async () => {
    const user = userEvent.setup();
    const { container } = render(<FeedPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /真实热点标题/ })).toBeInTheDocument());
    expect(container.querySelector("button a")).toBeNull();
    expect(screen.getByRole("link", { name: "查看原文" })).toHaveAttribute("href", "https://example.com/trend");
    await user.click(screen.getByRole("button", { name: /真实热点标题/ }));
    await user.click(screen.getByRole("button", { name: "生成内容包" }));

    await waitFor(() => expect(createFeedPackageMock).toHaveBeenCalledWith("test-token", expect.objectContaining({
      trendItemId: packageRecord.trend_item_id,
    })));
  });

  it("restores a package and workflow step from the URL", async () => {
    searchParamsMock.current = new URLSearchParams({
      packageId: packageRecord.id,
      step: "2",
    });

    render(<FeedPage />);

    await waitFor(() => expect(fetchFeedPackageMock).toHaveBeenCalledWith("test-token", packageRecord.id));
    expect(await screen.findByText("生成标题")).toBeInTheDocument();
    expect(screen.getByText(/当前步骤：脚本/)).toBeInTheDocument();
  });

  it("announces draft availability per selected platform", async () => {
    searchParamsMock.current = new URLSearchParams({
      packageId: packageRecord.id,
      step: "1",
    });

    render(<FeedPage />);

    await waitFor(() => expect(fetchFeedPackageMock).toHaveBeenCalledWith("test-token", packageRecord.id));
    const statuses = screen.getByRole("region", { name: "平台草稿状态" });
    expect(statuses).toHaveTextContent("抖音：草稿已就绪");
    expect(statuses).toHaveTextContent("小红书：草稿已就绪");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("marks edited structure as dirty and protects browser leave", async () => {
    const user = userEvent.setup();
    searchParamsMock.current = new URLSearchParams({ packageId: packageRecord.id, step: "2" });
    render(<FeedPage />);

    await waitFor(() => expect(fetchFeedPackageMock).toHaveBeenCalledWith("test-token", packageRecord.id));
    const titleInput = await screen.findByDisplayValue("生成标题");
    await user.clear(titleInput);
    await user.type(titleInput, "未保存的新标题");
    expect(screen.getByTestId("feed-structure-dirty")).toHaveTextContent("有未保存修改");

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    fireEvent(window, beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it("patches edited structure, starts render, and exposes every selected platform", async () => {
    const user = userEvent.setup();
    await openCustomTopic(user);

    const titleInput = screen.getByDisplayValue("生成标题");
    await user.clear(titleInput);
    await user.type(titleInput, "修改后的标题");
    await user.click(screen.getByTestId("feed-approve-structure"));

    await waitFor(() => expect(approveFeedStructureMock).toHaveBeenCalledWith(
      "test-token",
      packageRecord.id,
      expect.objectContaining({ title: "修改后的标题" }),
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始生成图片与视频" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "开始生成图片与视频" }));
    await waitFor(() => expect(renderFeedPackageMock).toHaveBeenCalledWith("test-token", packageRecord.id));

    await user.click(screen.getByRole("button", { name: "查看平台适配" }));
    await user.click(screen.getByRole("button", { name: "进入排程与发布" }));
    expect(screen.getByTestId("feed-platform-douyin")).toBeInTheDocument();
    expect(screen.getByTestId("feed-platform-xiaohongshu")).toBeInTheDocument();
  });

  it("locks schedule submission while the server confirms the plan", async () => {
    const user = userEvent.setup();
    const api = await import("../src/lib/server-api");
    vi.mocked(api.fetchPublishingAccounts).mockResolvedValue([
      { id: "account-1", platform: "douyin", alias: "品牌抖音号", notes: "", status: "active", connection_mode: "scan_confirm" },
    ]);
    createFeedScheduleMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ id: "plan-1" }), 120)));
    searchParamsMock.current = new URLSearchParams({ packageId: packageRecord.id, step: "5" });
    render(<FeedPage />);

    await waitFor(() => expect(fetchFeedPackageMock).toHaveBeenCalledWith("test-token", packageRecord.id));
    await user.selectOptions(screen.getByRole("combobox", { name: "已绑定账号" }), "account-1");
    await user.type(screen.getByLabelText("计划发布时间"), "2030-01-01T10:00");
    const saveButton = screen.getByRole("button", { name: "保存排程" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(createFeedScheduleMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("任务已进入待确认，确认后才会进入发布队列。")).toBeVisible());
  });
});
