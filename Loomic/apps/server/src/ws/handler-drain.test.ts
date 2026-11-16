import { once } from "node:events";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { DrainGate } from "../runtime/drain-gate.js";
import { registerWsRoute } from "./handler.js";
import { ConnectionManager } from "./connection-manager.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(persist: () => Promise<void>, metadataFails = false) {
  const app = Fastify();
  await app.register(websocket);
  const connectionManager = new ConnectionManager();
  const commands = new DrainGate();
  const runId = randomUUID();
  const stream = vi.fn(async function* () {
    yield { type: "message.delta", runId, text: "saved answer", timestamp: new Date().toISOString() };
    yield { type: "run.completed", runId, timestamp: new Date().toISOString() };
  });
  const runs = { createRun: vi.fn(() => ({ runId, status: "accepted" })), streamRun: stream,
    cancelRun: vi.fn(), getModelUsage: vi.fn(() => null) };
  await registerWsRoute(app, {
    agentRuns: runs as never, connectionManager, commandGate: commands,
    auth: { authenticate: async () => ({ id: randomUUID(), accessToken: "test" }) } as never,
    threadService: { resolveOwnedSessionThread: async () => ({ threadId: "test-thread" }) } as never,
    agentRunMetadataService: { createAcceptedRun: async () => { if (metadataFails) throw new Error("database unavailable"); }, updateRun: vi.fn() },
    chatService: { createMessage: async () => { await persist(); return { id: randomUUID() }; } } as never,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Missing local server port");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/ws?token=test&connectionId=test-connection`);
  const messages: Array<Record<string, any>> = [];
  socket.on("message", frame => messages.push(JSON.parse(frame.toString())));
  await once(socket, "open");
  await vi.waitFor(() => expect(connectionManager.get("test-connection")).toBeDefined());
  const send = () => socket.send(JSON.stringify({ type: "command", action: "agent.run", payload: {
    sessionId: randomUUID(), conversationId: randomUUID(), prompt: "A test answer",
  } }));
  return { app, socket, messages, commands, runs, send, connectionManager };
}

it("waits for assistant-message persistence after the stream ends before draining the socket", async () => {
  const started = deferred(), saved = deferred();
  const f = await fixture(async () => { started.resolve(); await saved.promise; });
  try {
    f.send();
    await started.promise;
    let drained = false;
    const stopping = f.commands.drain().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(drained).toBe(false);
    expect(f.socket.readyState).toBe(WebSocket.OPEN);
    f.send();
    await vi.waitFor(() => expect(f.messages.some(message => message.type === "error" && /切换|停止|稍后/.test(message.message))).toBe(true));
    expect(f.runs.createRun).toHaveBeenCalledTimes(1);
    saved.resolve();
    await stopping;
    const closed = once(f.socket, "close");
    await f.connectionManager.drain();
    expect((await closed)[0]).toBe(1012);
  } finally {
    saved.resolve();
    f.socket.terminate();
    await f.app.close();
  }
});

it("refuses to start model work or acknowledge success if run ownership cannot be persisted", async () => {
  const f = await fixture(async () => {}, true);
  try {
    f.send();
    await vi.waitFor(() => expect(f.messages.some(message => message.type === "error")).toBe(true));
    expect(f.runs.streamRun).not.toHaveBeenCalled();
    expect(f.runs.cancelRun).toHaveBeenCalledOnce();
    expect(f.messages.some(message => message.type === "command.ack" && message.action === "agent.run")).toBe(false);
  } finally {
    f.socket.terminate();
    await f.app.close();
  }
});
