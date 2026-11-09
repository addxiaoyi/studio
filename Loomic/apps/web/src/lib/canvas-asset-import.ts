import {
  createExcalidrawImageElement,
  getViewportCenter,
  scaleToFit,
} from "./canvas-elements";
import { getServerBaseUrl } from "./env";
import { inspectCanvasMedia, readCanvasAsset } from "./canvas-media-file";

type SceneElement = Record<string, unknown>;
export type CanvasImportApi = {
  getSceneElements(): readonly SceneElement[];
  getAppState(): {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    zoom: { value: number };
  };
  addFiles(
    files: { id: string; dataURL: string; mimeType: string; created: number }[],
  ): void;
  updateScene(scene: {
    elements?: SceneElement[];
    appState?: Record<string, unknown>;
    captureUpdate?: string;
  }): void;
  scrollToContent?(
    elements: SceneElement[],
    options: { fitToContent: boolean },
  ): void;
};
const metadata = (element: SceneElement) =>
  (element.customData ?? {}) as Record<string, unknown>;
function findImported(api: CanvasImportApi, ids: string[]) {
  return api
    .getSceneElements()
    .find(
      (element) =>
        !element.isDeleted &&
        ids.some((id) =>
          [
            metadata(element).assetId,
            metadata(element).libraryAssetId,
            metadata(element).importAssetId,
          ].includes(id),
        ),
    );
}
function reveal(api: CanvasImportApi, element: SceneElement) {
  api.updateScene({
    appState: { selectedElementIds: { [String(element.id)]: true } },
  });
  api.scrollToContent?.([element], { fitToContent: true });
}
export async function importCanvasAsset(
  api: CanvasImportApi,
  token: string,
  id: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const prior = findImported(api, [id]);
  if (prior) {
    reveal(api, prior);
    return prior;
  }
  const asset = await readCanvasAsset(token, id, signal);
  const info = await inspectCanvasMedia(asset.file, signal);
  signal.throwIfAborted();
  const existing = findImported(api, [id, asset.assetId, asset.libraryAssetId]);
  if (existing) {
    reveal(api, existing);
    return existing;
  }
  const center = getViewportCenter(api.getAppState()),
    size = scaleToFit(info.width, info.height, 900);
  const placement = {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    ...size,
  };
  const url = `${getServerBaseUrl()}/api/uploads/${asset.assetId}/file`;
  const customData = {
    assetId: asset.assetId,
    libraryAssetId: asset.libraryAssetId,
    importAssetId: id,
    title: asset.title,
    source: "uploaded",
    storageUrl: url,
    mediaWidth: info.width,
    mediaHeight: info.height,
    mimeType: asset.file.type,
  };
  let element: SceneElement;
  if (asset.file.type.startsWith("image/")) {
    if (!info.dataUrl) throw new Error("图片解码未完成，请重试。");
    const fileId = `asset-${asset.assetId}`;
    element = {
      ...createExcalidrawImageElement({ fileId, ...placement }),
      customData,
    };
    api.addFiles([
      {
        id: fileId,
        dataURL: info.dataUrl,
        mimeType: asset.file.type,
        created: Date.now(),
      },
    ]);
  } else if (asset.file.type.startsWith("video/")) {
    const { fileId, crop, ...shape } = createExcalidrawImageElement({
      fileId: "",
      ...placement,
    });
    element = {
      ...shape,
      type: "embeddable",
      link: url,
      customData: {
        ...customData,
        isVideo: true,
        url,
        durationSeconds: info.duration,
        trimStart: 0,
        trimEnd: info.duration,
      },
    };
  } else throw new Error("请从时间线导入音频素材。");
  if (!element) throw new Error("画布未接受素材，请重试。");
  signal.throwIfAborted();
  const concurrent = findImported(api, [
    id,
    asset.assetId,
    asset.libraryAssetId,
  ]);
  if (concurrent) {
    reveal(api, concurrent);
    return concurrent;
  }
  // Stable identity also deduplicates a refresh before the URL handoff is consumed.
  element.id = `asset-${asset.assetId}`;
  api.updateScene({
    elements: [...api.getSceneElements(), element],
    captureUpdate: "IMMEDIATELY",
  });
  reveal(api, element);
  return element;
}
