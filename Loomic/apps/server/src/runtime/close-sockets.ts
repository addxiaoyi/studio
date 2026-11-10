import type { WebSocket } from "ws";

export async function closeSockets(sockets: Iterable<WebSocket>) {
  await Promise.all([...sockets].map(socket => new Promise<void>(resolve => {
    if (socket.readyState === 3) { resolve(); return; }
    const timer = setTimeout(() => { socket.terminate(); resolve(); }, 2000);
    timer.unref();
    socket.once("close", () => { clearTimeout(timer); resolve(); });
    socket.close(1012, "Service restarting; reconnect to continue");
  })));
}
