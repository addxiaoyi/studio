import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudioAssetPicker } from "@/components/studio-asset-picker";

const api = vi.hoisted(() => ({ fetchGeneratedAssets: vi.fn(), readStudioAsset: vi.fn() }));
vi.mock("@/lib/server-api", () => ({ fetchGeneratedAssets: api.fetchGeneratedAssets }));
vi.mock("@/lib/studio-media", () => ({ readStudioAsset: api.readStudioAsset, MAX_STUDIO_MEDIA_BYTES: 250 * 1024 * 1024 }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("downloads the file identifier while preserving the library identifier for import deduplication", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const assetObjectId = "123e4567-e89b-42d3-a456-426614174001";
  api.fetchGeneratedAssets.mockResolvedValue({ assets: [{ id, assetObjectId, title: "成片" }], pagination: { hasMore: false } });
  const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
  api.readStudioAsset.mockResolvedValue(file);
  const importAsset = vi.fn();
  render(<StudioAssetPicker token="test" importAsset={importAsset} />);
  fireEvent.click(screen.getByRole("button", { name: "从 Loomic 素材库导入" }));
  fireEvent.change(await screen.findByLabelText("选择素材"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "导入编辑器" }));
  await waitFor(() => expect(importAsset).toHaveBeenCalledWith(file, id));
  expect(api.readStudioAsset).toHaveBeenCalledWith("test", assetObjectId);
});

it("reports a missing file identity instead of requesting a record ID", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  api.fetchGeneratedAssets.mockResolvedValue({ assets: [{ id, title: "缺失文件" }] });
  render(<StudioAssetPicker token="test" importAsset={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "从 Loomic 素材库导入" }));
  fireEvent.change(await screen.findByLabelText("选择素材"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "导入编辑器" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("缺少文件标识");
  expect(api.readStudioAsset).not.toHaveBeenCalled();
});
