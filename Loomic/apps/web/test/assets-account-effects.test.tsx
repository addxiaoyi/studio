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
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({
  id: "owner",
  assets: vi.fn(),
  createProject: vi.fn(),
  push: vi.fn(),
  fetch: vi.fn(),
  objectUrl: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: { access_token: "same-token", user: { id: account.id } },
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets/",
  useRouter: () => ({ push: account.push }),
}));
vi.mock("@/components/gradual-blur", () => ({ GradualBlur: () => null }));
vi.mock("@/lib/server-api", () => ({
  fetchGeneratedAssets: account.assets,
  createProject: account.createProject,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function assetPage(title: string, assetObjectId?: string) {
  return {
    assets: [
      {
        id: title,
        title,
        assetObjectId,
        mediaType: "image",
        createdAt: "2026-11-15",
        url: `/api/files/${title}`,
        published: false,
      },
    ],
    pagination: { page: 1, pageSize: 12, total: 1, hasMore: false },
  };
}

beforeEach(() => {
  account.assets
    .mockResolvedValueOnce(assetPage("Old asset", "old-object"))
    .mockResolvedValueOnce(assetPage("New asset", "new-object"));
  account.fetch.mockResolvedValue(new Response(null, { status: 404 }));
  account.objectUrl.mockReturnValue("blob:private-preview");
  vi.stubGlobal("fetch", account.fetch);
  const NativeURL = URL;
  vi.stubGlobal(
    "URL",
    Object.assign(class extends NativeURL {}, {
      createObjectURL: account.objectUrl,
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  account.id = "owner";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("ignores a previous account's canvas response but still opens the current account's canvas", async () => {
  const oldProject = deferred<{ project: { primaryCanvas: { id: string } } }>();
  account.createProject
    .mockReturnValueOnce(oldProject.promise)
    .mockResolvedValueOnce({
      project: { primaryCanvas: { id: "new-canvas" } },
    });
  const view = render(<AssetsPage />);
  await screen.findByText("Old asset");
  fireEvent.click(screen.getByRole("button", { name: "在画布中编辑" }));
  await waitFor(() => expect(account.createProject).toHaveBeenCalledOnce());
  account.id = "peer";
  view.rerender(<AssetsPage />);
  await screen.findByText("New asset");
  await act(async () =>
    oldProject.resolve({ project: { primaryCanvas: { id: "old-canvas" } } }),
  );
  expect(account.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "在画布中编辑" }));
  await waitFor(() =>
    expect(account.push).toHaveBeenCalledExactlyOnceWith(
      "/canvas?id=new-canvas&assetId=new-object&mediaType=image",
    ),
  );
});

it("does not start a browser download when an old account's file arrives late", async () => {
  const download = deferred<Response>();
  account.assets
    .mockReset()
    .mockResolvedValueOnce(assetPage("Old asset"))
    .mockResolvedValueOnce(assetPage("New asset"));
  account.fetch.mockImplementation((url: string) =>
    url.includes("download=1")
      ? download.promise
      : Promise.resolve(new Response(null, { status: 404 })),
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const view = render(<AssetsPage />);
  await screen.findByText("Old asset");
  fireEvent.click(
    screen.getByRole("button", { name: "下载 Old asset 原文件" }),
  );
  expect(account.fetch).toHaveBeenCalledWith(
    expect.stringContaining("download=1"),
    expect.any(Object),
  );
  account.id = "peer";
  view.rerender(<AssetsPage />);
  await screen.findByText("New asset");
  await act(async () =>
    download.resolve(
      new Response("private image", {
        headers: { "content-type": "image/png" },
      }),
    ),
  );
  expect(click).not.toHaveBeenCalled();
  expect(account.objectUrl).not.toHaveBeenCalled();
});

it("does not retain a private preview blob that finishes after its account unmounts", async () => {
  const preview = deferred<Blob>();
  account.fetch.mockResolvedValueOnce({
    ok: true,
    headers: new Headers({ "content-type": "image/png" }),
    blob: () => preview.promise,
  });
  const view = render(<AssetsPage />);
  await screen.findByText("Old asset");
  await waitFor(() => expect(account.fetch).toHaveBeenCalledOnce());
  account.id = "peer";
  view.rerender(<AssetsPage />);
  await screen.findByText("New asset");
  await act(async () => preview.resolve(new Blob(["old private image"])));
  expect(account.objectUrl).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "预览 Old asset" }),
  ).not.toBeInTheDocument();
});
