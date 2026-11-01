const { app } = require("electron");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const WebSocket = require("ws");

const { HELT_ELECTRON_TEST_USER_DATA: userData, HELT_ELECTRON_TEST_WS: url } = process.env;
if (!userData || !path.isAbsolute(userData) || !url || !url.startsWith("ws://127.0.0.1:")) {
  throw new Error("The Electron test needs isolated user data and a loopback WebSocket.");
}
app.setPath("userData", userData);

const sourcePath = path.join(__dirname, "../electron/desktop-action-receipts.ts");
const source = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded._compile(source, sourcePath);
const receipts = new loaded.exports.DesktopActionReceipts();
let executions = 0;

function connect() {
  const socket = new WebSocket(url);
  socket.on("open", () => socket.send(JSON.stringify({ type: "fixture.ready", executions })));
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    if (message.type === "desktop_agent.action") {
      const action = message.action;
      executions += 1;
      receipts.register(action.taskId, action.approvalId, action.requestId);
      socket.send(JSON.stringify({ type: "fixture.executed", action, executions }));
    } else if (message.type === "desktop_agent.action_recorded") {
      const accepted = receipts.consume(message.taskId, message.approvalId, message.requestId);
      socket.send(JSON.stringify({ type: "fixture.receipt", accepted, executions }));
    } else if (message.type === "desktop_agent.resume") {
      socket.send(JSON.stringify({ type: "fixture.resumed", executions }));
    }
  });
  socket.on("close", () => setTimeout(connect, 50));
  socket.on("error", (error) => console.error("Electron fixture WebSocket error:", error.message));
}

app.whenReady().then(connect).catch((error) => {
  console.error("Electron receipt fixture failed:", error);
  app.exit(1);
});
