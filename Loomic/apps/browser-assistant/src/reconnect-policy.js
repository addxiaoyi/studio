const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 8;

export function getReconnectDelay(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= MAX_RECONNECT_ATTEMPTS) {
    return null;
  }

  return Math.min(INITIAL_RECONNECT_DELAY_MS * (2 ** attempt), MAX_RECONNECT_DELAY_MS);
}
