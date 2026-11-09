import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AssetsPage from "@/app/(workspace)/assets/page";
const requests = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token" } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/gradual-blur", () => ({ GradualBlur: () => null }));
vi.mock("@/lib/server-api", () => ({
  fetchGeneratedAssets: requests.fetch,
  createProject: vi.fn(),
  deleteGeneratedAssets: vi.fn(),
  publishAsset: vi.fn(),
  unpublishAsset: vi.fn(),
  restoreGeneratedAsset: vi.fn(),
}));
vi.mock("@/lib/local-asset-storage", () => ({
  chooseLocalAssetFolder: vi.fn(),
  getLocalAssetFolderName: async () => null,
  saveAssetToLocalFolder: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("ignores a slower old search response after newer results are visible", async () => {
  let old!: (value: unknown) => void, newest!: (value: unknown) => void;
  requests.fetch
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          newest = resolve;
        }),
    );
  render(<AssetsPage />);
  await waitFor(() => expect(requests.fetch).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "new" } });
  await waitFor(() => expect(requests.fetch).toHaveBeenCalledTimes(2));
  const reply = (title: string) => ({
    assets: [
      {
        id: title,
        title,
        mediaType: "image",
        createdAt: "2026-11-09T00:00:00Z",
        retentionState: "active",
        retentionUntil: "2026-11-12T00:00:00Z",
      },
    ],
    pagination: { page: 1, pageSize: 12, total: 1, hasMore: false },
  });
  await act(async () => newest(reply("new result")));
  expect(screen.getByText("new result")).toBeInTheDocument();
  await act(async () => old(reply("stale result")));
  expect(screen.getByText("new result")).toBeInTheDocument();
  expect(screen.queryByText("stale result")).toBeNull();
});
