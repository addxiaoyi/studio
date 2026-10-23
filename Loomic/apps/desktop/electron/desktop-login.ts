export type DesktopLoginCallback = {
  state: string;
  token: string;
};

export function parseDesktopLoginCallback(value: string): DesktopLoginCallback | null {
  let callback: URL;
  try {
    callback = new URL(value);
  } catch {
    return null;
  }

  if (
    callback.protocol !== "helstera:" ||
    callback.hostname !== "auth" ||
    callback.pathname !== "/callback" ||
    callback.port ||
    callback.username ||
    callback.password ||
    callback.hash
  ) return null;

  const state = callback.searchParams.get("state") ?? "";
  const token = callback.searchParams.get("desktop_token") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  return { state, token };
}

export class DesktopLoginCallbackQueue {
  private readonly queued = new Map<string, DesktopLoginCallback>();
  private readonly deliveries = new Map<string, Promise<boolean>>();

  enqueue(value: string, pending: ReadonlyMap<string, number>, now = Date.now()) {
    const callback = parseDesktopLoginCallback(value);
    const expiresAt = callback ? pending.get(callback.state) : undefined;
    if (!callback || !expiresAt || expiresAt <= now) return null;

    const previous = this.queued.get(callback.state);
    if (previous && previous.token !== callback.token) return null;
    this.queued.set(callback.state, callback);
    return callback;
  }

  deliver(state: string, send: (callback: DesktopLoginCallback) => Promise<void>) {
    const active = this.deliveries.get(state);
    if (active) return active;

    const callback = this.queued.get(state);
    if (!callback) return Promise.resolve(false);

    const delivery = send(callback)
      .then(() => {
        this.queued.delete(state);
        return true;
      })
      .catch(() => false)
      .finally(() => this.deliveries.delete(state));
    this.deliveries.set(state, delivery);
    return delivery;
  }

  pending() {
    return [...this.queued.values()];
  }

  discard(state: string) {
    this.queued.delete(state);
  }

  clear() {
    this.queued.clear();
  }
}
