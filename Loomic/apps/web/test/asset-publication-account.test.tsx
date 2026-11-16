import "@testing-library/jest-dom/vitest";
import AssetsPage from "@/app/(workspace)/assets/page";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "owner",
  fetchAssets: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: { access_token: "same-token", user: { id: state.userId } },
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/gradual-blur", () => ({ GradualBlur: () => null }));
vi.mock("@/lib/server-api", () => ({
  fetchGeneratedAssets: state.fetchAssets,
  publishAsset: state.publish,
  unpublishAsset: vi.fn(),
  createProject: vi.fn(),
  deleteGeneratedAssets: vi.fn(),
  restoreGeneratedAsset: vi.fn(),
}));
vi.mock("@/lib/local-asset-storage", () => ({
  chooseLocalAssetFolder: vi.fn(),
  getLocalAssetFolderName: async () => null,
  saveAssetToLocalFolder: vi.fn(),
}));
afterEach(() => {
  cleanup();
  state.userId = "owner";
  vi.clearAllMocks();
});
function assets(title: string) {
  return {
    assets: [
      {
        id: title,
        title,
        mediaType: "video",
        mimeType: "video/mp4",
        createdAt: "2026-11-15",
        url: null,
        published: false,
      },
    ],
    pagination: { page: 1, pageSize: 12, total: 1, hasMore: false },
  };
}

it("remounts private assets and publication when the account changes even with the same token", async () => {
  let finish!: () => void;
  state.fetchAssets
    .mockResolvedValueOnce(assets("旧账号成片"))
    .mockResolvedValueOnce(assets("新账号成片"));
  state.publish.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AssetsPage />);
  await screen.findByText("旧账号成片");
  fireEvent.click(screen.getByRole("button", { name: "公开作品" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("旧账号成片");
  fireEvent.click(screen.getByRole("button", { name: "确认公开作品" }));
  await waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
  state.userId = "peer";
  view.rerender(<AssetsPage />);
  await screen.findByText("新账号成片");
  expect(screen.queryByText("旧账号成片")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "公开作品" }));
  await act(async () => {
    finish();
  });
  expect(screen.getByRole("dialog")).toHaveTextContent("新账号成片");
  expect(screen.queryByText("作品已公开到作品库")).not.toBeInTheDocument();
  expect(state.fetchAssets).toHaveBeenCalledTimes(2);
});
