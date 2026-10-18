export function resolveImageReferences(
  attachments: ReadonlyArray<{ assetId: string; url: string }>,
  downloaded: Readonly<Record<string, string>>,
): string[] {
  // Keep user order: image 1 and image 2 can have different roles.
  const references = attachments.map((attachment) =>
    downloaded[attachment.assetId] ?? attachment.url,
  );
  return [...new Set(references.filter((url) => /^(https?:|data:image[/])/.test(url)))];
}
