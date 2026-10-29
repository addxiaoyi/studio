import { describe, expect, it } from "vitest";
import { readLocalAgentHistory, saveLocalAgentEvent } from "./agent-history-store.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("local Agent history", () => {
  it("retains bounded events locally and scrubs credential-like text", () => {
    const storage = memoryStorage();
    saveLocalAgentEvent(storage, {
      taskId: "task-1", eventType: "started", goal: "Open the project", executionMode: "windows_ui",
      canvasId: "canvas-1", detail: "Started with token=secret-value",
    });
    saveLocalAgentEvent(storage, { taskId: "task-1", eventType: "reobserve", detail: "Round 2" });

    const [task] = readLocalAgentHistory(storage);
    expect(task?.goal).toBe("Open the project");
    expect(task?.canvasId).toBe("canvas-1");
    expect(task?.events).toHaveLength(2);
    expect(task?.events[0]?.detail).toContain("token=[hidden]");
  });

  it("ignores a malformed local cache", () => {
    const storage = memoryStorage();
    storage.setItem("helstera.desktop-agent-history.v1", "not-json");
    expect(readLocalAgentHistory(storage)).toEqual([]);
  });
});
