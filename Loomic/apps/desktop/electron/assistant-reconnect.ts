export const ASSISTANT_RECONNECT_BASE_MS = 500;
export const ASSISTANT_RECONNECT_MAX_MS = 30_000;
export const ASSISTANT_RECONNECT_MAX_EXPONENT = 6;

export function assistantReconnectDelay(attempt: number, random = Math.random) {
  const exponent = Math.max(0, Math.min(Math.floor(attempt), ASSISTANT_RECONNECT_MAX_EXPONENT));
  const base = Math.min(ASSISTANT_RECONNECT_MAX_MS, ASSISTANT_RECONNECT_BASE_MS * 2 ** exponent);
  return Math.min(ASSISTANT_RECONNECT_MAX_MS, Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4)));
}

export function shouldReconnectAssistant(code: number) {
  return ![4001, 4003, 4004].includes(code);
}
