const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeVideoDataUri(uri: string, expectedMimeType: string): Buffer {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(uri);
  if (!match) throw new Error("Generated video data URI must contain base64 data");
  const [, mimeType, encoded] = match;
  if (mimeType!.toLowerCase() !== expectedMimeType.toLowerCase()) {
    throw new Error("Generated video data URI MIME type does not match provider metadata");
  }
  if (!encoded || !BASE64_PATTERN.test(encoded)) throw new Error("Generated video data URI contains invalid base64 data");
  if (encoded.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4) throw new Error("Generated video exceeds the 250MB limit");

  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("Generated video is empty");
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error("Generated video exceeds the 250MB limit");
  return buffer;
}

export function resolveVideoMimeType(providerMimeType: string | undefined, responseMimeType: string | null): string {
  const providerType = providerMimeType?.split(";")[0]?.trim().toLowerCase();
  const responseType = responseMimeType?.split(";")[0]?.trim().toLowerCase();
  const isVideoType = (value: string | undefined): value is string => Boolean(value?.startsWith("video/"));

  if (isVideoType(providerType) && isVideoType(responseType) && providerType !== responseType) {
    throw new Error("Generated video response MIME type does not match provider metadata");
  }
  if (isVideoType(providerType)) return providerType;
  if (isVideoType(responseType)) return responseType;
  return "video/mp4";
}

export async function readVideoBody(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VIDEO_BYTES) {
    throw new Error("Generated video exceeds the 250MB limit");
  }
  if (!response.body) throw new Error("Generated video download returned an empty body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_VIDEO_BYTES) throw new Error("Generated video exceeds the 250MB limit");
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("250MB limit")) {
      await reader.cancel(error).catch(() => undefined);
    }
    throw new Error("Generated video download stream failed: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    reader.releaseLock();
  }

  if (total === 0) throw new Error("Generated video download returned an empty body");
  return Buffer.concat(chunks, total);
}
