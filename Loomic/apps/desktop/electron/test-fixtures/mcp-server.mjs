import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";

const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === "initialize") {
    result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local-test", version: "1.0.0" } };
  } else if (message.method === "tools/list") {
    result = { tools: [{ name: "probe", description: "Local test tool", inputSchema: { type: "object", properties: { marker: { type: "string" } } } }] };
  } else if (message.method === "tools/call") {
    const marker = message.params.arguments?.marker;
    if (marker) {
      await writeFile(marker, "started");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    result = { content: [{ type: "text", text: "ok" }] };
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Not found" } }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
