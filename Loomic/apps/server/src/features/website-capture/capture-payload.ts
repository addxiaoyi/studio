const MAX_JPEG_BYTES = 8 * 1024 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeJpegPayload(value: string, maxBytes = MAX_JPEG_BYTES): Buffer {
  const match = value.match(/^data:image\/jpeg;base64,([\s\S]*)$/i);
  const base64 = match ? match[1] : value;
  if (!base64 || !BASE64_PATTERN.test(base64)) throw new Error("桌面截图 Base64 数据无效。");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > maxBytes) throw new Error("桌面截图超过大小限制。");
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error("桌面截图不是有效的 JPEG 图像。");
  return bytes;
}
