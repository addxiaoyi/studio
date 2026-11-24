import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProjectThumbnail } from "../src/lib/canvas-thumbnail";

const { exportToBlob } = vi.hoisted(() => ({ exportToBlob: vi.fn(async (_input: unknown) => new Blob(["preview"], { type: "image/webp" })) }));
vi.mock("@excalidraw/excalidraw", () => ({ exportToBlob }));
vi.mock("../src/lib/env", () => ({ getServerBaseUrl: () => "https://studio.0st.top" }));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const fileId = "7e4269dd-160f-48d2-a720-a2ca698a74d1";
function scene(link = `/api/uploads/${fileId}/file`) {
  const elements = [{ id: "video", type: "embeddable", x: 20, y: 30, width: 640, height: 360, angle: 0.2, link, customData: { isVideo: true }, isDeleted: false }];
  const files = {};
  return { elements, files, api: { getSceneElements: () => elements, getFiles: () => files, getAppState: () => ({ viewBackgroundColor: "#fafafa" }) } };
}
function exported() { return exportToBlob.mock.calls[0]?.[0] as unknown as { elements: Array<Record<string, unknown>>; files: Record<string, {dataURL: string}>; appState: Record<string, unknown> }; }

describe("project canvas thumbnail", () => {
  it("exports an authenticated video poster without altering the editable video or saving its path as text", async () => {
    const fetchPreview = vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "image/jpeg" }), blob: async () => new Blob(["jpeg"], { type: "image/jpeg" }) }));
    vi.stubGlobal("fetch", fetchPreview);
    const { api, elements, files } = scene();
    await buildProjectThumbnail(api, "desktop-session");
    const preview = exported();
    expect(preview.elements[0]).toMatchObject({ id: "video", type: "image", x: 20, y: 30, width: 640, height: 360, angle: 0.2, link: null });
    expect(preview.files[String(preview.elements[0]!.fileId)]?.dataURL).toMatch(/^data:image\/jpeg;base64,/);
    expect(fetchPreview).toHaveBeenCalledWith(`https://studio.0st.top/api/uploads/${fileId}/file?preview=1`, expect.objectContaining({ credentials: "include", headers: { Authorization: "Bearer desktop-session" } }));
    expect(elements[0]!.type).toBe("embeddable");
    expect(elements[0]!.link).toBe(`/api/uploads/${fileId}/file`);
    expect(files).toEqual({});
    expect(preview.appState.viewBackgroundColor).toBe("#fafafa");
  });

  it("uses an explicit video fallback for unavailable media, without exporting internal paths", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api } = scene();
    await buildProjectThumbnail(api, "local-cookie");
    const preview = exported();
    expect(preview.elements[0]!.type).toBe("image");
    expect(preview.elements[0]!.link).toBeNull();
    const image = preview.files[String(preview.elements[0]!.fileId)]!.dataURL;
    expect(decodeURIComponent(image)).toContain("视频预览暂不可用");
    expect(JSON.stringify(preview)).not.toContain("/api/uploads/");
  });

  it("never forwards an account token to an external video address", async () => {
    const fetchPreview = vi.fn();vi.stubGlobal("fetch", fetchPreview);
    const { api } = scene(`https://unrelated.example/api/uploads/${fileId}/file`);
    await buildProjectThumbnail(api, "desktop-session");
    expect(fetchPreview).not.toHaveBeenCalled();
    expect(exported().elements[0]!.link).toBeNull();
  });

  it("deduplicates poster requests and never restores deleted elements into the thumbnail", async () => {
    const fetchPreview = vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "image/png" }), blob: async () => new Blob(["png"], { type: "image/png" }) }));
    vi.stubGlobal("fetch", fetchPreview);
    const { api, elements } = scene();
    elements.push({ ...elements[0]!, id: "copy" }, { ...elements[0]!, id: "deleted", isDeleted: true });
    await buildProjectThumbnail(api, "local-cookie");
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    expect(exported().elements.map(element => element.id)).toEqual(["video", "copy"]);
  });

  it("waits for canvas images to resolve instead of replacing a valid thumbnail with unloaded files", async () => {
    const api = { getSceneElements: () => [{ id: "photo", type: "image", fileId: "loading" }],
      getFiles: () => ({ loading: { storageUrl: "/api/uploads/photo/file" } }), getAppState: () => ({}) };
    expect(await buildProjectThumbnail(api, "local-cookie")).toBeNull();
    expect(exportToBlob).not.toHaveBeenCalled();
  });
});
