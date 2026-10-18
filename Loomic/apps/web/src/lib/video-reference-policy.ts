export type VideoReference = {
  mimeType: string;
};

export function selectVideoReferences<T extends VideoReference>(attachments: readonly T[]): T[] {
  return attachments.filter((attachment) => attachment.mimeType.startsWith("image/")).slice(0, 1);
}

export function selectRetryReferences<T extends VideoReference & { assetId?: string; url?: string }>(
  attachments: readonly T[],
  isVideo: boolean,
): T[] {
  const unique = attachments.filter((attachment, index, all) => {
    const key = attachment.assetId ?? attachment.url;
    return all.findIndex((candidate) => (candidate.assetId ?? candidate.url) === key) === index;
  });
  return isVideo ? selectVideoReferences(unique) : unique;
}
