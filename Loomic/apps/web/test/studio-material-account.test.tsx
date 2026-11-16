import "@testing-library/jest-dom/vitest";
import { StudioMaterialGeneration } from "@/components/studio-material-generation";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  models: vi.fn(),
  read: vi.fn(),
  objectUrl: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/server-api", () => ({ fetchVideoModels: api.models }));
vi.mock("@/lib/studio-media", () => ({ readStudioAsset: api.read }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => "en-US" }));
vi.mock("@/hooks/use-studio-video-generation", () => ({
  useStudioVideoGeneration: () => ({
    state: {
      phase: "succeeded",
      assetId: "asset-1",
      request: { key: "old-task", draft: { prompt: "A shot" } },
    },
    busy: false,
    error: "",
    reset: vi.fn(),
    refresh: vi.fn(),
    cancel: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Read not started");
  };
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function runtime() {
  return {
    projectId: () => "project-1",
    readAsset: vi.fn(),
    importAsset: vi.fn().mockResolvedValue(undefined),
    listMedia: () => [{ name: "generated-asset-1-clip.mp4" }],
  };
}
const request = { type: "generate" as const, prompt: "A shot" };
beforeEach(() => {
  vi.resetAllMocks();
  api.models.mockResolvedValue({ models: [] });
  api.objectUrl.mockReturnValue("blob:private-video");
  vi.stubGlobal("URL", {
    createObjectURL: api.objectUrl,
    revokeObjectURL: api.revoke,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  { userId: "other", compositionId: "project-1", label: "account" },
  { userId: "owner", compositionId: "project-2", label: "project" },
])("does not import an old read after switching $label", async (next) => {
  const pending = deferred<File | null>();
  const editor = runtime();
  editor.readAsset.mockReturnValue(pending.promise);
  const imported = vi.fn();
  const view = render(
    <StudioMaterialGeneration
      request={request}
      userId="owner"
      token="same-token"
      compositionId="project-1"
      runtime={editor as unknown as StudioRuntime}
      onImported={imported}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import result" }));
  view.rerender(
    <StudioMaterialGeneration
      request={request}
      userId={next.userId}
      token="same-token"
      compositionId={next.compositionId}
      runtime={editor as unknown as StudioRuntime}
      onImported={imported}
    />,
  );
  await act(async () => {
    pending.resolve(new File(["video"], "clip.mp4"));
  });
  expect(editor.importAsset).not.toHaveBeenCalled();
  expect(api.objectUrl).not.toHaveBeenCalled();
  expect(imported).not.toHaveBeenCalled();
});

it("does not start a fallback download after an old account's cache read returns empty", async () => {
  const pending = deferred<null>();
  const editor = runtime();
  editor.readAsset.mockReturnValue(pending.promise);
  api.read.mockResolvedValue(new File(["private"], "clip.mp4"));
  const view = render(
    <StudioMaterialGeneration
      request={request}
      userId="owner"
      token="same-token"
      compositionId="project-1"
      runtime={editor as unknown as StudioRuntime}
      onImported={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import result" }));
  view.rerender(
    <StudioMaterialGeneration
      request={request}
      userId="other"
      token="same-token"
      compositionId="project-1"
      runtime={editor as unknown as StudioRuntime}
      onImported={vi.fn()}
    />,
  );
  await act(async () => {
    pending.resolve(null);
  });
  expect(api.read).not.toHaveBeenCalled();
});

it("does not create a preview or announce an import that finishes after its account changed", async () => {
  const pending = deferred<void>();
  const editor = runtime();
  editor.readAsset.mockResolvedValue(new File(["video"], "clip.mp4"));
  editor.importAsset.mockReturnValue(pending.promise);
  const imported = vi.fn();
  const view = render(
    <StudioMaterialGeneration
      request={request}
      userId="owner"
      token="same-token"
      compositionId="project-1"
      runtime={editor as unknown as StudioRuntime}
      onImported={imported}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import result" }));
  await waitFor(() => expect(editor.importAsset).toHaveBeenCalledOnce());
  view.rerender(
    <StudioMaterialGeneration
      request={request}
      userId="other"
      token="same-token"
      compositionId="project-1"
      runtime={editor as unknown as StudioRuntime}
      onImported={imported}
    />,
  );
  await act(async () => {
    pending.resolve();
  });
  expect(api.objectUrl).not.toHaveBeenCalled();
  expect(imported).not.toHaveBeenCalled();
});
