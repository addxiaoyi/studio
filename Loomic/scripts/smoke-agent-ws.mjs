import WebSocket from "../apps/server/node_modules/ws/wrapper.mjs";

const [url, token, sessionId, canvasId, prompt = "仅回复 OK，不调用工具。", imageModel] = process.argv.slice(2);
if (!url || !token || !sessionId || !canvasId) {
  throw new Error("Usage: smoke-agent-ws.mjs <url> <token> <sessionId> <canvasId>");
}

const connectionId = `smoke-${Date.now()}`;
const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}&connectionId=${connectionId}`);
const timeout = setTimeout(() => {
  console.error("SMOKE_TIMEOUT");
  ws.close();
  process.exitCode = 1;
}, 180_000);

let runId;
let text = "";
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "command",
    action: "agent.run",
    payload: {
      sessionId,
      conversationId: canvasId,
      canvasId,
      prompt,
      accessToken: "local-session",
      ...(imageModel ? { imageGenerationPreference: { mode: "manual", models: [imageModel] } } : {}),
    },
  }));
});
ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "command.ack" && message.action === "agent.run") {
    runId = message.payload.runId;
    return;
  }
  if (message.type !== "event" || (runId && message.event.runId !== runId)) return;
  if (message.event.type === "message.delta") text += message.event.delta;
  if (message.event.type === "run.failed") {
    clearTimeout(timeout);
    console.error("SMOKE_FAILED", JSON.stringify(message.event));
    ws.close();
    process.exitCode = 1;
  }
  if (message.event.type === "run.completed") {
    clearTimeout(timeout);
    console.log("SMOKE_OK", JSON.stringify({ runId, text }));
    ws.close();
  }
});
ws.on("error", (error) => {
  clearTimeout(timeout);
  console.error("SMOKE_WS_ERROR", error.message);
  process.exitCode = 1;
});
