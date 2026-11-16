import "@testing-library/jest-dom/vitest";
import { GalleryMediaPreview } from "@/components/gallery-media-preview";
import { PublishAssetDialog } from "@/components/publish-asset-dialog";
import { parseGallery } from "@/lib/gallery-api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
const vtt =
  "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n\n00:01.000 --> 00:02.000\nWorld";
function file(text: string) {
  const picked = new File([text], "captions.vtt", { type: "text/vtt" });
  Object.defineProperty(picked, "text", { value: async () => text });
  return picked;
}

it("defaults to no caption publication and sends no hidden subtitle state", async () => {
  const confirm = vi.fn().mockResolvedValue(undefined);
  render(
    <PublishAssetDialog
      title="成片"
      video
      busy={false}
      onConfirm={confirm}
      onCancel={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("checkbox", { name: "同时公开我选择的字幕" }),
  ).not.toBeChecked();
  expect(screen.queryByLabelText("字幕文件（WebVTT）")).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认公开作品" }));
  });
  expect(confirm).toHaveBeenCalledWith(undefined);
});

it("previews actual cues and requires explicit selection before publishing their text", async () => {
  const confirm = vi.fn().mockResolvedValue(undefined);
  render(
    <PublishAssetDialog
      title="成片"
      video
      busy={false}
      onConfirm={confirm}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同时公开我选择的字幕" }),
  );
  expect(
    screen.getByRole("button", { name: "确认公开作品和字幕" }),
  ).toBeDisabled();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("字幕文件（WebVTT）"), {
      target: { files: [file(vtt)] },
    });
  });
  expect(
    screen.getByRole("region", { name: "将公开的字幕预览" }),
  ).toHaveTextContent("Hello");
  fireEvent.change(screen.getByLabelText("字幕语言"), {
    target: { value: "en" },
  });
  fireEvent.change(screen.getByLabelText("播放器字幕名称"), {
    target: { value: "English" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认公开作品和字幕" }));
  });
  expect(confirm).toHaveBeenCalledWith({
    vtt,
    language: "en",
    label: "English",
    consent: true,
  });
});

it("retains preview on a failed publication and omits it after the owner unchecks", async () => {
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(new Error("网络失败"))
    .mockResolvedValue(undefined);
  render(
    <PublishAssetDialog
      title="成片"
      video
      busy={false}
      onConfirm={confirm}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同时公开我选择的字幕" }),
  );
  await act(async () => {
    fireEvent.change(screen.getByLabelText("字幕文件（WebVTT）"), {
      target: { files: [file(vtt)] },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认公开作品和字幕" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("网络失败");
  expect(
    screen.getByRole("region", { name: "将公开的字幕预览" }),
  ).toHaveTextContent("World");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同时公开我选择的字幕" }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认公开作品" }));
  });
  expect(confirm).toHaveBeenLastCalledWith(undefined);
});

it("rejects malformed files and never creates an empty captions track", async () => {
  render(
    <PublishAssetDialog
      title="成片"
      video
      busy={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同时公开我选择的字幕" }),
  );
  await act(async () => {
    fireEvent.change(screen.getByLabelText("字幕文件（WebVTT）"), {
      target: { files: [file("<svg onload='alert(1)'>")] },
    });
  });
  expect(screen.getByRole("alert")).toHaveTextContent("WEBVTT");
  expect(
    screen.getByRole("button", { name: "确认公开作品和字幕" }),
  ).toBeDisabled();
  cleanup();
  const view = render(
    <GalleryMediaPreview url="/video.mp4" title="成片" type="video" />,
  );
  expect(view.container.querySelector("track")).toBeNull();
  view.rerender(
    <GalleryMediaPreview
      url="/video.mp4"
      title="成片"
      type="video"
      caption={{
        url: "/api/gallery/g/captions.vtt",
        language: "en",
        label: "English",
      }}
    />,
  );
  expect(view.container.querySelector("track")).toHaveAttribute(
    "src",
    "/api/gallery/g/captions.vtt",
  );
  expect(view.container.querySelector("track")).toHaveAttribute(
    "kind",
    "captions",
  );
});

it("ignores external caption URLs in the Gallery feed", () => {
  const item = {
    id: "g",
    asset_id: "a",
    media_type: "video",
    object_url: "/api/gallery/g/media",
    like_count: 0,
    comment_count: 0,
    caption: {
      url: "https://outside.test/private.vtt",
      language: "en",
      label: "Bad",
    },
  };
  expect(parseGallery([item])[0]?.caption).toBeUndefined();
});
