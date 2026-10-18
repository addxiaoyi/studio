import { isNanoImageModelId } from "@helstera/shared";

const REMOVED_IMAGE_MODEL_IDS = new Set(["gpt-image-1", "gpt-image-1.5", "doubao-seededit-3-0-i2i-250628", "high_aes_general_v30l_zt2i"]);
const REMOVED_MODEL_IDS = new Set([
  "agnes-3.0-flash",
]);
const REMOVED_MODEL_PREFIXES = ["grok-", "gk-video-"];

export function isRemovedModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase().replace(/^openai:/, "");
  const shortId = normalized.split(/[/:]/).filter(Boolean).at(-1) ?? normalized;
  return REMOVED_IMAGE_MODEL_IDS.has(shortId)
    || REMOVED_MODEL_IDS.has(shortId)
    || REMOVED_MODEL_PREFIXES.some((prefix) => shortId.startsWith(prefix));
}

export function isRemovedImageModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase().replace(/^openai:/, "");
  const shortId = normalized.split(/[/:]/).filter(Boolean).at(-1);
  return shortId
    ? REMOVED_IMAGE_MODEL_IDS.has(shortId)
      || isNanoImageModelId(normalized)
    : false;
}
