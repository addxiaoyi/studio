/**
 * Live socket state bus.
 *
 * The desktop shell renders chrome (a connection banner) around pages that each own
 * their own WebSocket through `use-websocket`. Those pages are the only place that
 * knows whether the socket is up, so they publish it here and the shell subscribes —
 * no second socket, no prop drilling through every mode.
 */
export type RealtimeStatus = "connected" | "disconnected";

type Listener = (status: RealtimeStatus) => void;

const listeners = new Set<Listener>();
let current: RealtimeStatus = "disconnected";
let hasConnectedOnce = false;

export function publishRealtimeStatus(status: RealtimeStatus) {
  if (status === "connected") hasConnectedOnce = true;
  if (status === current) return;
  current = status;
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // A broken subscriber must never break the socket lifecycle.
    }
  }
}

export function getRealtimeStatus(): RealtimeStatus {
  return current;
}

/** True once any socket has gone live in this session, so the banner can stay quiet
 *  during the initial connect instead of flashing "disconnected" on every load. */
export function hasEverConnected(): boolean {
  return hasConnectedOnce;
}

export function subscribeRealtimeStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: reset module state between cases. */
export function resetRealtimeStatusForTests() {
  listeners.clear();
  current = "disconnected";
  hasConnectedOnce = false;
}
