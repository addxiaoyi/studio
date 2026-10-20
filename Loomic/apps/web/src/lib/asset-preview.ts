export function isCompatibleAssetPreviewMime(mediaType: "image" | "video", mimeType: string): boolean {
  if (mediaType === "image") return mimeType.startsWith("image/");
  // Video previews are JPEG frames; the original endpoint may return video MIME.
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
}
