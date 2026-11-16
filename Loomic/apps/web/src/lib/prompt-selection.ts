export const SELECTED_PROMPT_KEY = "helstera_selected_prompt";
export const PROMPT_RETURN_KEY = "helstera_prompt_return";
export const MAX_SELECTED_PROMPT_LENGTH = 8000;
export class PromptSelectionError extends Error {}

export function promptReturnPath(
  address: string | null,
  origin: string,
): string {
  if (!address || address.includes("\\")) return "/home/";
  try {
    const target = new URL(address, origin);
    if (
      target.origin !== origin ||
      target.username ||
      target.password ||
      !["http:", "https:"].includes(target.protocol) ||
      target.pathname.startsWith("//")
    )
      return "/home/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/home/";
  }
}

function validatePrompt(text: string) {
  if (!text.trim())
    throw new PromptSelectionError("提示词内容为空，请选择其他提示词。");
  if (text.length > MAX_SELECTED_PROMPT_LENGTH) {
    throw new PromptSelectionError(
      `提示词超过 ${MAX_SELECTED_PROMPT_LENGTH} 字，请先复制后精简。`,
    );
  }
}

export function selectPrompt(
  storage: Storage,
  text: string,
  origin: string,
): string {
  validatePrompt(text);
  const destination = promptReturnPath(
    storage.getItem(PROMPT_RETURN_KEY),
    origin,
  );
  storage.setItem(SELECTED_PROMPT_KEY, text);
  storage.removeItem(PROMPT_RETURN_KEY);
  return destination;
}

export function consumeSelectedPrompt(storage: Storage): string | null {
  const text = storage.getItem(SELECTED_PROMPT_KEY);
  if (text === null) return null;
  validatePrompt(text);
  storage.removeItem(SELECTED_PROMPT_KEY);
  return text;
}
