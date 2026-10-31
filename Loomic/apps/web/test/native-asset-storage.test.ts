// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseLocalAssetFolder, getLocalAssetFolderState, saveAssetToLocalFolder } from "../src/lib/local-asset-storage";

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(window, "electronAPI"); });

describe("native asset storage", () => {
  it("uses the main process folder status without depending on browser IndexedDB", async () => {
    const status = { name: "Assets", path: "D:/Assets", permission: "granted", availableBytes: 1024 };
    const api = { getAssetFolderStatus: vi.fn().mockResolvedValue(status), selectAssetFolder: vi.fn().mockResolvedValue({ name: "Assets", path: "D:/Assets" }) };
    Object.assign(window, { electronAPI: api });
    expect(await chooseLocalAssetFolder()).toBe("Assets");
    expect(await getLocalAssetFolderState()).toEqual(status);
  });

  it("does not download or write when the selected folder is unavailable", async () => {
    const writeAssetToLocal = vi.fn();
    Object.assign(window, { electronAPI: {
      getAssetFolderStatus: vi.fn().mockResolvedValue({ name: "Assets", path: "D:/Assets", permission: "denied", error: "Folder offline" }),
      writeAssetToLocal,
    } });
    const download = vi.fn();
    vi.stubGlobal("fetch", download);
    await expect(saveAssetToLocalFolder({ url: "https://example.test/image.png", accessToken: "test", fileName: "Image", mediaType: "image" })).rejects.toThrow("Folder offline");
    expect(download).not.toHaveBeenCalled();
    expect(writeAssetToLocal).not.toHaveBeenCalled();
  });
});
